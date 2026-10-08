#!/usr/bin/env python3
"""Local AetherSDR → QRZ logger; Python standard library only."""
import argparse
import datetime as dt
import errno
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError

ROOT = Path(__file__).resolve().parent
CALL = re.compile(r"[A-Z0-9/]{3,20}\Z")
BANDS = [(1.8,2,'160m'),(3.5,4,'80m'),(5,5.5,'60m'),(7,7.3,'40m'),
         (10.1,10.15,'30m'),(14,14.35,'20m'),(18.068,18.168,'17m'),
         (21,21.45,'15m'),(24.89,24.99,'12m'),(28,29.7,'10m'),
         (50,54,'6m'),(70,71,'4m'),(144,148,'2m'),(420,450,'70cm')]
MODES = {'SSB','CW','AM','FM','RTTY','FT8','FT4','PSK31','SSTV','MFSK','JS8','DIGITALVOICE'}

def ascii_text(value):
    """ADIF legacy text fields are ASCII; keep original XML in the local record."""
    return unicodedata.normalize('NFKD',str(value)).encode('ascii','ignore').decode().replace('<','(').replace('>',')').replace('\r',' ').replace('\n',' ')

def profile_adif(profile):
    p = profile.get('fields',{})
    fields = {}
    name = ' '.join(filter(None,[p.get('fname',''),p.get('name','')]))
    if name: fields['NAME'] = ascii_text(name)
    for source,target in [('addr2','QTH'),('grid','GRIDSQUARE'),('land','COUNTRY'),
                          ('state','STATE'),('email','EMAIL'),('url','WEB'),('iota','IOTA')]:
        if p.get(source): fields[target] = ascii_text(p[source])
    if not fields.get('COUNTRY') and p.get('country'): fields['COUNTRY'] = ascii_text(p['country'])
    address = '\n'.join(p[k] for k in ('attn','addr1','addr2','state','zip','country') if p.get(k))
    if address: fields['ADDRESS'] = ascii_text(address)
    for source,target,maximum in [('dxcc','DXCC',899),('cqzone','CQZ',40),('ituzone','ITUZ',90)]:
        v = p.get(source,'')
        if v.isdigit() and 0 < int(v) <= maximum: fields[target] = v
    if p.get('county') and p.get('state'): fields['CNTY'] = ascii_text(p['state']+','+p['county'])
    if p.get('qslmgr','').upper() not in ('','NONE'): fields['QSL_VIA'] = ascii_text(p['qslmgr'])
    for source,target,limit,positive,negative in [('lat','LAT',90,'N','S'),('lon','LON',180,'E','W')]:
        try: v = float(p[source])
        except (ValueError,KeyError): continue
        if not math.isfinite(v) or abs(v)>limit: continue
        minutes = round(abs(v)*60,3)
        degree = int(minutes//60)
        fields[target] = f'{positive if v>=0 else negative}{degree:03d} {minutes-degree*60:06.3f}'
    # Preserve every returned Callsign field in the ADIF backup as well.
    raw = json.dumps(p,ensure_ascii=True,separators=(',',':')).replace('<','\\u003c').replace('>','\\u003e')
    if p: fields['APP_AETHERQRZ_PROFILE'] = raw
    return fields

class LookupError(Exception):
    pass

def adif_field(name, value):
    value = str(value)
    if any(c in value for c in '<>\r\n') or not value.isascii():
        raise ValueError('Ongeldige tekens in een logveld.')
    return f'<{name}:{len(value)}>{value}'

def make_adif(record, station):
    call = str(record.get('call','')).strip().upper()
    station = station.strip().upper()
    if not CALL.fullmatch(call) or not CALL.fullmatch(station):
        raise ValueError('Vul een geldige call en eigen roepnaam in.')
    stamp = dt.datetime.fromisoformat(record['time'].replace('Z','+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('Tijd moet een tijdzone bevatten.')
    stamp = stamp.astimezone(dt.timezone.utc)
    freq = float(record['frequency'])
    if not math.isfinite(freq):
        raise ValueError('Ongeldige frequentie.')
    band = next((b for lo,hi,b in BANDS if lo <= freq <= hi), None)
    if not band:
        raise ValueError('Frequentie valt buiten de ondersteunde amateurbanden.')
    mode = str(record['mode']).upper()
    if mode not in MODES:
        raise ValueError('Selecteer de juiste logmode.')
    fields = {'CALL':call,'STATION_CALLSIGN':station,'QSO_DATE':stamp.strftime('%Y%m%d'),
              'TIME_ON':stamp.strftime('%H%M%S'),'FREQ':f'{freq:.6f}', 'BAND':band}
    # FT4, JS8 and PSK31 use the ADIF parent mode plus SUBMODE.
    parent = {'FT4':'MFSK','JS8':'MFSK','PSK31':'PSK'}
    fields['MODE'] = parent.get(mode,mode)
    if mode in parent:
        fields['SUBMODE'] = mode
    for source, target in [('sent','RST_SENT'),('received','RST_RCVD'),('comment','COMMENT')]:
        val = str(record.get(source,'')).strip()
        if val:
            if len(val) > (300 if source=='comment' else 10):
                raise ValueError('Rapport of opmerking is te lang.')
            fields[target] = val
    power = record.get('power','')
    if power not in ('',None):
        power = float(power)
        if not math.isfinite(power) or not 0 <= power <= 100000:
            raise ValueError('Ongeldig vermogen in watt.')
        fields['TX_PWR'] = f'{power:g}'
    rx = record.get('rxFrequency')
    if rx not in ('',None):
        rx = float(rx)
        if not math.isfinite(rx) or rx <= 0:
            raise ValueError('Ongeldige ontvangstfrequentie.')
        if abs(rx-freq) > 0.0000001:
            fields['FREQ_RX'] = f'{rx:.6f}'
    if record.get('profile',{}).get('query') == call:
        fields.update(profile_adif(record['profile']))
    signal = record.get('signal')
    if isinstance(signal,dict):
        dbm = float(signal['dbm'])
        if not math.isfinite(dbm) or not -200 < dbm <= 50: raise ValueError('Ongeldige S-metermeting.')
        fields['APP_AETHERQRZ_RX_DBM'] = f'{dbm:g}'
        fields['APP_AETHERQRZ_S_METER'] = str(signal.get('label',''))[:40]
    return ''.join(adif_field(k,v) for k,v in fields.items()) + '<EOR>'

class Logger:
    def __init__(self, data_dir):
        self.dir = Path(data_dir)
        self.dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.config_path = self.dir/'settings.json'
        self.config = {'station':'','tciUrl':'ws://127.0.0.1:50001','power':'','key':'',
                       'xmlUser':'','xmlPassword':'','rememberKey':False,'rememberXml':False}
        if self.config_path.exists():
            self.config.update(json.loads(self.config_path.read_text()))
        self.config['rememberKey'] = bool(self.config['key'])
        self.config['rememberXml'] = bool(self.config['xmlPassword'])
        self.xml_session = ''
        self.lookup_cache = {}
        self.db = sqlite3.connect(self.dir/'log.sqlite3')
        self.db.execute('CREATE TABLE IF NOT EXISTS qsos (id TEXT PRIMARY KEY, record TEXT, adif TEXT, status TEXT, detail TEXT)')
        self.db.commit()
        os.chmod(self.dir/'log.sqlite3',0o600)

    def public_config(self):
        return {**{k:v for k,v in self.config.items() if k not in ('key','xmlPassword')},
                'hasKey':bool(self.config['key']),
                'hasLookup':bool(self.config['xmlUser'] and self.config['xmlPassword'])}

    def configure(self, values):
        station = str(values.get('station','')).strip().upper()
        if not CALL.fullmatch(station):
            raise ValueError('Vul je eigen roepnaam in.')
        url = str(values.get('tciUrl',''))
        if not re.fullmatch(r'wss?://[A-Za-z0-9.\[\]:_-]+(?::\d+)?/?',url):
            raise ValueError('Gebruik een TCI-adres zoals ws://127.0.0.1:50001.')
        key = str(values.get('key','')).strip() or self.config['key']
        if not re.fullmatch(r'[A-Za-z0-9-]{8,128}',key):
            raise ValueError('Vul je QRZ Logbook API-sleutel in.')
        power = str(values.get('power','')).strip()
        if power and (not math.isfinite(float(power)) or not 0 <= float(power) <= 100000):
            raise ValueError('Ongeldig standaardvermogen.')
        user = str(values.get('xmlUser',self.config['xmlUser'])).strip()
        password = str(values.get('xmlPassword','')) or self.config['xmlPassword']
        if user != self.config['xmlUser'] and not values.get('xmlPassword'):
            password = ''
        if len(user)>128 or len(password)>256: raise ValueError('Ongeldige QRZ-login.')
        changed = (user,password) != (self.config['xmlUser'],self.config['xmlPassword'])
        self.config = dict(station=station,tciUrl=url,power=power,key=key,xmlUser=user,xmlPassword=password,
                           rememberKey=bool(values.get('rememberKey')),rememberXml=bool(values.get('rememberXml')))
        if changed:
            self.xml_session = ''; self.lookup_cache.clear()
        saved = dict(self.config)
        if not values.get('rememberKey'):
            saved['key'] = ''
        if not values.get('rememberXml'):
            saved['xmlPassword'] = ''
        fd = os.open(self.config_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        os.chmod(self.config_path,0o600)
        with os.fdopen(fd,'w') as f:
            json.dump(saved,f)
        return self.public_config()

    def xml_request(self, values):
        req = Request('https://xmldata.qrz.com/xml/current/',data=urlencode(values).encode(),
                      headers={'User-Agent':'AetherQRZLocal/1.1','Content-Type':'application/x-www-form-urlencoded'})
        try:
            with urlopen(req,timeout=12) as response: content = response.read(262145)
            if len(content)>262144 or b'<!DOCTYPE' in content or b'<!ENTITY' in content:
                raise LookupError('Ongeldig QRZ XML-antwoord.')
            root = ET.fromstring(content)
            # Work with both namespaced and unnamespaced QRZ responses.
            for node in root.iter(): node.tag = node.tag.rsplit('}',1)[-1]
            return root
        except (URLError,TimeoutError,OSError,ET.ParseError):
            raise LookupError('QRZ-stationsgegevens zijn nu niet bereikbaar. Probeer opnieuw.') from None

    def xml_error(self, text):
        for secret in (self.config['key'],self.config['xmlPassword'],self.xml_session):
            if secret: text = text.replace(secret,'[privé]')
        return text[:400]

    def xml_login(self):
        root = self.xml_request({'username':self.config['xmlUser'],'password':self.config['xmlPassword'],
                                 'agent':'AetherQRZLocal1.1'})
        key = root.findtext('Session/Key','')
        if not key:
            raise LookupError(self.xml_error(root.findtext('Session/Error','QRZ XML-login mislukt.')))
        self.xml_session = key

    def lookup(self, call):
        call = str(call).strip().upper()
        if not CALL.fullmatch(call): raise LookupError('Vul een geldige call in.')
        if not self.config['xmlUser'] or not self.config['xmlPassword']:
            raise LookupError('Vul bij Instellingen je QRZ-gebruikersnaam en wachtwoord in voor stationsgegevens.')
        cached = self.lookup_cache.get(call)
        if cached and time.monotonic()-cached[0]<900: return cached[1]
        self.lookup_cache.pop(call,None)
        if not self.xml_session: self.xml_login()
        for attempt in range(2):
            root = self.xml_request({'s':self.xml_session,'callsign':call})
            key = root.findtext('Session/Key','')
            if not key:
                self.xml_session = ''
                if attempt==0:
                    self.xml_login(); continue
                raise LookupError('QRZ XML-sessie verlopen. Controleer je login.')
            self.xml_session = key
            error = root.findtext('Session/Error','')
            if error: raise LookupError(self.xml_error(error))
            station = root.find('Callsign')
            if station is None: raise LookupError('QRZ heeft geen stationsgegevens teruggegeven.')
            fields = {n.tag:(n.text or '').strip()[:2048] for n in station if n.text}
            result = {'query':call,'fields':fields,'notice':self.xml_error(root.findtext('Session/Message',''))}
            self.lookup_cache[call] = (time.monotonic(),result)
            return result

    def upload(self, record):
        if not self.config['key']:
            raise ValueError('Stel eerst je QRZ Logbook API-sleutel in.')
        ident = str(record.get('id',''))
        if not re.fullmatch(r'[a-f0-9-]{36}',ident):
            raise ValueError('Ongeldig verbindingsnummer.')
        record = dict(record)
        # Attach only the profile fetched for this exact entered call. Never carry
        # the previous station's metadata into a new QSO.
        record.pop('profile',None)
        cached = self.lookup_cache.get(str(record.get('call','')).strip().upper())
        if cached: record['profile'] = cached[1]
        adif = make_adif(record,self.config['station'])
        old = self.db.execute('SELECT status,detail FROM qsos WHERE id=?',(ident,)).fetchone()
        if old:
            return {'status':old[0], 'detail':old[1], 'repeated':True}
        self.db.execute('INSERT INTO qsos VALUES (?,?,?,?,?)',
                        (ident,json.dumps(record),adif,'uncertain','Controleer QRZ voordat je opnieuw logt.'))
        self.db.commit()
        body = urlencode({'KEY':self.config['key'],'ACTION':'INSERT','ADIF':adif}).encode()
        req = Request('https://logbook.qrz.com/api',data=body,
                      headers={'User-Agent':f'AetherQRZLocal/1.0 ({self.config["station"]})',
                               'Content-Type':'application/x-www-form-urlencoded'})
        try:
            with urlopen(req,timeout=25) as response:
                parsed = parse_qs(response.read(262144).decode('utf-8'),keep_blank_values=True)
            result = parsed.get('RESULT',[''])[0]
            if result=='OK':
                status = 'ok'
                detail = 'Opgeslagen in QRZ Logbook.'
            elif result in ('FAIL','AUTH'):
                status = 'failed'
                reason = parsed.get('REASON',['QRZ heeft de verbinding geweigerd.'])[0]
                detail = reason.replace(self.config['key'],'[sleutel]')[:400]
            else:
                status,detail = 'uncertain','Onbekend QRZ-antwoord. Controleer je QRZ-logboek voordat je opnieuw logt.'
        except (URLError,TimeoutError,OSError,UnicodeError):
            status,detail = 'uncertain','Geen bevestiging ontvangen. De verbinding staat lokaal; controleer QRZ voordat je opnieuw logt.'
        self.db.execute('UPDATE qsos SET status=?,detail=? WHERE id=?',(status,detail,ident))
        self.db.commit()
        return {'status':status,'detail':detail}

    def history(self):
        return [dict(id=i,**json.loads(r),status=s,detail=d) if 'id' not in json.loads(r)
                else dict(**json.loads(r),status=s,detail=d)
                for i,r,s,d in self.db.execute('SELECT id,record,status,detail FROM qsos ORDER BY rowid DESC LIMIT 30')]

    def export(self):
        # Include every local record, including unconfirmed uploads, with status.
        header = 'Aether QRZ lokaal logboek\n<ADIF_VER:5>3.1.4<EOH>\n'
        return header + '\n'.join(a.replace('<EOR>',adif_field('APP_AETHERQRZ_STATUS',s)+'<EOR>')
                                   for a,s in self.db.execute('SELECT adif,status FROM qsos ORDER BY rowid')) + '\n'

def handler_for(logger, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not write submitted fields or secrets to access logs.

        def valid_host(self):
            return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'

        def reply(self, code, body, mime='application/json'):
            if isinstance(body,(dict,list)):
                body = json.dumps(body)
            body = body.encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type',mime+'; charset=utf-8')
            self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('X-Frame-Options','DENY')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.valid_host():
                return self.reply(403,{'error':'Ongeldige host.'})
            if self.path=='/':
                return self.reply(200,(ROOT/'index.html').read_text().replace('__TOKEN__',token),'text/html')
            if self.path in ('/app.js','/tci.js','/style.css'):
                mime = 'text/css' if self.path.endswith('.css') else 'text/javascript'
                return self.reply(200,(ROOT/self.path[1:]).read_text(),mime)
            if self.path in ('/api/config','/api/history','/api/export'):
                if not secrets.compare_digest(self.headers.get('X-Token',''),token):
                    return self.reply(403,{'error':'Ongeldige sessie.'})
                if self.path=='/api/config': return self.reply(200,logger.public_config())
                if self.path=='/api/history': return self.reply(200,logger.history())
                return self.reply(200,logger.export(),'text/plain')
            self.reply(404,{'error':'Niet gevonden.'})

        def do_POST(self):
            origin = f'http://127.0.0.1:{self.server.server_port}'
            if not self.valid_host() or self.headers.get('Origin') != origin or not secrets.compare_digest(self.headers.get('X-Token',''),token):
                return self.reply(403,{'error':'Ongeldige sessie.'})
            try:
                length = int(self.headers.get('Content-Length','0'))
                if not 0 < length <= 8192: raise ValueError('Ongeldige aanvraag.')
                values = json.loads(self.rfile.read(length))
                if self.path=='/api/config': result = logger.configure(values)
                elif self.path=='/api/lookup': result = logger.lookup(values.get('call',''))
                elif self.path=='/api/log': result = logger.upload(values)
                else: return self.reply(404,{'error':'Niet gevonden.'})
                self.reply(200,result)
            except LookupError as error:
                self.reply(400,{'error':str(error)})
            except (ValueError,KeyError,TypeError):
                self.reply(400,{'error':'Controleer de invoer: call, instellingen, frequentie, mode en tijd.'})
    return Handler

def existing_logger(url):
    try:
        with urlopen(url,timeout=2) as response:
            page = response.read(65536)
        return b'<title>Aether \xc2\xb7 QRZ logboek</title>' in page and b'name="session-token"' in page
    except (URLError,TimeoutError,OSError):
        return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--no-browser',action='store_true')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('Poort moet tussen 1 en 65535 liggen.')
    os.umask(0o077)
    logger = Logger(ROOT/'data')
    url = f'http://127.0.0.1:{args.port}'
    try:
        server = HTTPServer(('127.0.0.1',args.port),handler_for(logger,secrets.token_urlsafe(32)))
    except OSError as error:
        logger.db.close()
        if error.errno == errno.EADDRINUSE:
            if existing_logger(url):
                print(f'Het logboek draait al. De bestaande interface staat op {url}',flush=True)
                if not args.no_browser:
                    import webbrowser
                    webbrowser.open(url)
                return 0
            print(f'Poort {args.port} is in gebruik door een ander programma. Het logboek is niet gestart.',flush=True)
        else:
            print('Het logboek kon niet starten. Controleer of lokale netwerktoegang is toegestaan.',flush=True)
        return 1
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'Aether QRZ draait op {url}\nStoppen: Ctrl+C',flush=True)
    if not args.no_browser:
        import webbrowser
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        logger.db.close()

if __name__=='__main__': sys.exit(main())
