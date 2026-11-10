const assert = require('node:assert/strict');
const {TciState,logMode,signalReport,withSignal} = require('./tci.js');
const s=new TciState();
s.ingest('device:AetherSDR;vfo:0,0,14290000;vfo:0,1,14292000;modulation:0,usb;tx_enable:0,true;drive:0,75;sta');
assert.equal(s.selected(),null);
s.ingest('rt;ready;');
assert.equal(s.selected().frequency,14292000);
assert.equal(s.selected().rx,14290000);
assert.equal(s.selected().drive,75);
assert.equal(logMode(s.selected().mode),'SSB');
s.ingest('vfo:1,0,7074000;modulation:1,digu;tx_enable:0,false;tx_enable:1,true;');
assert.equal(s.selected().id,'1');
assert.equal(logMode(s.selected().mode),'');
assert.equal(s.selected('0').frequency,14290000);
s.ingest('vfo:1,0,not-a-frequency;');
assert.equal(s.selected().frequency,7074000);
s.ingest('rx_enable:1,false;');
assert.equal(s.selected(),null);
s.ingest('stop;');
assert.equal(s.selected('0'),null);
assert.deepEqual(s.slices,{});
assert.equal(signalReport(-73,14292000).strength,9);
assert.equal(signalReport(-85,14292000).strength,7);
assert.equal(signalReport(-93,144300000).strength,9);
assert.equal(signalReport(-53,14292000).label,'S9 +20 dB');
assert.equal(signalReport(-150,14292000).strength,1);
assert.equal(withSignal('59','SSB',7),'57');
assert.equal(withSignal('459','CW',7),'479');
assert.equal(withSignal('59','CW',7),'579');
assert.equal(withSignal('-12','FT8',7),'-12');
const realNow=Date.now;
let now=100000; Date.now=()=>now;
const meter=new TciState();
meter.ingest('vfo:0,0,14292000;modulation:0,usb;tx_enable:0,true;start;ready;rx_smeter:0,-85;');
assert.equal(meter.selected().signal.strength,7);
meter.ingest('rx_channel_sensors:0,0,-73;rx_smeter:0,NaN;rx_smeter:0,;');
assert.equal(meter.selected().signal.strength,9);
meter.ingest('trx:0,true;rx_smeter:0,-20;');
now+=10000;
assert.equal(meter.selected().signal.strength,9); // Hold last RX while transmitting.
meter.ingest('trx:0,false;');
assert.equal(meter.selected().signal,null);
meter.ingest('rx_smeter:0,-79;vfo:0,0,7074000;');
assert.equal(meter.selected().signal,null); // Tuning invalidates the old measurement.
Date.now=realNow;
// Regression: replay deskHPSDR's reported TX VFO, not idle channel 1.
for (const [name,receiver,tx,expected] of [
  ['normal A','0','0',7118200], ['normal B','1','1',14288400],
  ['split TX A','1','0',7118200], ['split TX B','0','1',14288400]
]) {
  const radio=new TciState();
  radio.ingest('device:SunSDR2QRP;vfo:0,0,7118200;vfo:0,1,14288400;modulation:0,lsb;'+
    (receiver==='1'?'vfo:1,0,14288400;modulation:1,usb;':'modulation:1,usb;')+
    'tx_enable:0,true;split_enable:0,'+(tx==='1'?'true':'false')+';tx_frequency:'+expected+';start;ready;');
  assert.equal(radio.selected().frequency,expected,name);
  assert.equal(radio.selected().id,tx,name+' TX VFO');
  assert.equal(radio.selected('a').frequency,7118200);
  assert.equal(radio.selected('b').frequency,14288400);
  radio.ingest('tx_frequency:12345678;');
  assert.equal(radio.selected(),null,name+' mismatched reports block logging');
  radio.reset();
  assert.equal(radio.txFrequency,null);
  assert.equal(radio.txVfo,null);
}
console.log('TCI: split, TX-slice, modes, fragments, invalid data and radio disconnect passed.');
