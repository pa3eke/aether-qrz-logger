import copy
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import parse_qs
import server

RECORD = dict(id='00000000-0000-4000-8000-000000000001',call='PA0ABC',
              frequency=14.292,rxFrequency=14.292,mode='SSB',
              time='2026-10-08T12:34:56+02:00',sent='59',received='57',power='75',comment='')

class Reply:
    def __init__(self, text): self.text=text.encode()
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def read(self,*args): return self.text

class LogTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.log=server.Logger(self.temp.name)
        self.log.configure(dict(station='PA1XYZ',key='TEST-LOCAL-KEY',tciUrl='ws://127.0.0.1:50001',power=''))

    def tearDown(self):
        self.log.db.close(); self.temp.cleanup()

    def test_utc_frequency_power_and_split(self):
        r=copy.copy(RECORD); r['rxFrequency']=14.290
        adif=server.make_adif(r,'PA1XYZ')
        for value in ['<TIME_ON:6>103456','<QSO_DATE:8>20261008','<FREQ:9>14.292000',
                      '<FREQ_RX:9>14.290000','<TX_PWR:2>75','<BAND:3>20m']:
            self.assertIn(value,adif)

    def test_digital_submode_and_missing_power(self):
        r=copy.copy(RECORD); r.update(mode='FT4',power='')
        adif=server.make_adif(r,'PA1XYZ')
        self.assertIn('<MODE:4>MFSK<SUBMODE:3>FT4',adif)
        self.assertNotIn('TX_PWR',adif)

    def test_signal_sent_and_received_are_separate(self):
        r=dict(RECORD,sent='57',received='59',signal={'dbm':-85,'label':'S7'})
        adif=server.make_adif(r,'PA1XYZ')
        self.assertIn('<RST_SENT:2>57',adif)
        self.assertIn('<RST_RCVD:2>59',adif)
        self.assertIn('<APP_AETHERQRZ_RX_DBM:3>-85',adif)

    def test_invalid_data_rejected(self):
        for field,value in [('call','<EOR>'),('frequency',float('nan')),('mode','DIGU'),
                            ('power',-1),('comment','<CALL:4>FAKE')]:
            r=copy.copy(RECORD); r[field]=value
            with self.subTest(field=field), self.assertRaises(ValueError):
                server.make_adif(r,'PA1XYZ')

    @patch('server.urlopen')
    def test_success_and_idempotent_repeat(self, request):
        request.return_value=Reply('RESULT=OK&LOGID=123&COUNT=1')
        self.assertEqual(self.log.upload(RECORD)['status'],'ok')
        self.assertTrue(self.log.upload(RECORD)['repeated'])
        request.assert_called_once()
        body=parse_qs(request.call_args.args[0].data.decode())
        self.assertEqual(body['ACTION'],['INSERT'])
        self.assertNotIn('OPTION',body)  # No destructive REPLACE.
        self.assertIn('PA1XYZ',request.call_args.args[0].get_header('User-agent'))
        self.assertEqual(self.log.history()[0]['status'],'ok')
        self.assertIn('APP_AETHERQRZ_STATUS:2>ok',self.log.export())

    @patch('server.urlopen')
    def test_refusal_kept_locally(self, request):
        request.return_value=Reply('RESULT=AUTH&REASON=Subscription+required')
        self.assertEqual(self.log.upload(RECORD)['status'],'failed')
        self.assertEqual(len(self.log.history()),1)

    @patch('server.urlopen')
    def test_timeout_never_automatically_retried(self, request):
        request.side_effect=URLError('timeout')
        self.assertEqual(self.log.upload(RECORD)['status'],'uncertain')
        self.assertTrue(self.log.upload(RECORD)['repeated'])
        request.assert_called_once()

    def test_secret_not_exposed_or_saved_by_default(self):
        self.assertNotIn('key',self.log.public_config())
        self.assertNotIn('TEST-LOCAL-KEY',self.log.config_path.read_text())
        self.assertEqual(self.log.config_path.stat().st_mode & 0o777,0o600)

    def xml_configure(self):
        self.log.configure(dict(station='PA1XYZ',tciUrl='ws://127.0.0.1:50001',power='',
                                xmlUser='PA1XYZ',xmlPassword='not-a-real-password'))

    @patch('server.urlopen')
    def test_xml_namespaces_cache_and_profile_upload(self, request):
        self.xml_configure()
        request.side_effect=[Reply('<QRZDatabase><Session><Key>session1</Key></Session></QRZDatabase>'),
          Reply('<QRZDatabase xmlns="http://xmldata.qrz.com"><Callsign><call>PA0ABC</call><fname>Andre</fname><name>Test</name><addr2>Utrecht</addr2><land>Netherlands</land><grid>JO22MA</grid><cqzone>14</cqzone><ituzone>27</ituzone><lat>52.1</lat><lon>5.1</lon><qslmgr>PA1QSL</qslmgr><future_field>extra</future_field></Callsign><Session><Key>session2</Key></Session></QRZDatabase>'),
          Reply('RESULT=OK&LOGID=123')]
        found=self.log.lookup('pa0abc')
        self.assertEqual(found['fields']['addr2'],'Utrecht')
        self.assertEqual(self.log.lookup('PA0ABC'),found)
        self.assertEqual(request.call_count,2)
        self.assertEqual(self.log.upload(RECORD)['status'],'ok')
        adif=parse_qs(request.call_args.args[0].data.decode())['ADIF'][0]
        for value in ['<NAME:10>Andre Test','<QTH:7>Utrecht','<GRIDSQUARE:6>JO22MA','<CQZ:2>14','<ITUZ:2>27','<LAT:11>N052 06.000','<QSL_VIA:6>PA1QSL']:
            self.assertIn(value,adif)
        self.assertIn('future_field',self.log.export())
        self.assertEqual(self.log.history()[0]['profile']['fields']['grid'],'JO22MA')
        self.assertNotIn('session2',self.log.export())

    @patch('server.urlopen')
    def test_xml_reauth_on_expired_session(self, request):
        self.xml_configure(); self.log.xml_session='expired'
        request.side_effect=[Reply('<QRZDatabase><Session><Error>Session Timeout</Error></Session></QRZDatabase>'),
          Reply('<QRZDatabase><Session><Key>new</Key></Session></QRZDatabase>'),
          Reply('<QRZDatabase><Callsign><call>PA0ABC</call></Callsign><Session><Key>new</Key><Message>Subscription required for complete data</Message></Session></QRZDatabase>')]
        self.assertIn('Subscription',self.log.lookup('PA0ABC')['notice'])
        self.assertEqual(request.call_count,3)

    @patch('server.urlopen')
    def test_not_found_does_not_relogin_or_attach_other_station(self, request):
        self.xml_configure(); self.log.xml_session='valid'
        self.log.lookup_cache['PA0OTHER']=(0,{'query':'PA0OTHER','fields':{'fname':'Wrong'}})
        request.return_value=Reply('<QRZDatabase><Session><Key>valid</Key><Error>Not found: PA0ABC</Error></Session></QRZDatabase>')
        with self.assertRaises(server.LookupError): self.log.lookup('PA0ABC')
        request.assert_called_once()
        request.return_value=Reply('RESULT=OK')
        self.log.upload(dict(RECORD,profile={'query':'PA0ABC','fields':{'fname':'Injected'}}))
        self.assertNotIn('<NAME:',self.log.export())

    def test_xml_password_private_and_unicode_backup(self):
        self.xml_configure()
        self.assertNotIn('xmlPassword',self.log.public_config())
        self.assertNotIn('not-a-real-password',self.log.config_path.read_text())
        p={'query':'PA0ABC','fields':{'fname':'André','addr2':'München','name':'<Test>'}}
        adif=server.make_adif(dict(RECORD,profile=p),'PA1XYZ')
        self.assertIn('Andre (Test)',adif)
        self.assertIn('Munchen',adif)
        self.assertIn('Andr\\u00e9',adif)

    @patch('server.urlopen')
    def test_existing_logger_identification(self, request):
        request.return_value=Reply('<title>Aether · QRZ logboek</title><meta name="session-token" content="test">')
        self.assertTrue(server.existing_logger('http://127.0.0.1:8765'))
        request.return_value=Reply('<title>Other application</title>')
        self.assertFalse(server.existing_logger('http://127.0.0.1:8765'))
        request.side_effect=URLError('connection refused')
        self.assertFalse(server.existing_logger('http://127.0.0.1:8765'))

if __name__=='__main__': unittest.main()
