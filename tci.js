/* Passive TCI state reader: never sends radio commands. */
class TciState {
  constructor() { this.reset(); }
  reset() { this.slices = {}; this.ready = false; this.running = false; this.device = ''; this.tail = ''; this.drive = null; this.transmitting = false; }
  ingest(text) {
    this.tail += text;
    const commands = this.tail.split(';'); this.tail = commands.pop();
    if (this.tail.length > 65536) this.tail = '';
    for (const command of commands) {
      const colon = command.indexOf(':');
      const name = (colon < 0 ? command : command.slice(0, colon)).trim().toLowerCase();
      const a = colon < 0 ? [] : command.slice(colon+1).split(',').map(x => x.trim());
      if (name === 'ready') { this.ready = true; continue; }
      if (name === 'start') { this.running = true; continue; }
      if (name === 'stop') { this.reset(); this.ready = true; continue; }
      if (name === 'device') { this.device = a.join(','); continue; }
      if (name === 'drive') {
        const p = Number(a[a.length-1]);
        if (a.length && a[a.length-1] !== '' && Number.isFinite(p) && p >= 0 && p <= 100) this.drive = p;
        continue;
      }
      if (name === 'trx' && ['true','false'].includes(a[1])) { this.transmitting = a[1] === 'true'; continue; }
      if (['rx_smeter','rx_channel_sensors'].includes(name)) {
        const channel = name === 'rx_channel_sensors' ? a[1] : '0';
        const value = name === 'rx_channel_sensors' ? a[2] : a[1];
        const dbm = Number(value), s = this.slices[a[0]];
        if (s && channel === '0' && value !== '' && Number.isFinite(dbm) && dbm > -200 && dbm <= 50 && !this.transmitting) {
          const now = Date.now();
          s.meter = (s.meter || []).filter(p=>now-p.time<=5000);
          s.meter.push({dbm,time:now});
          if (s.meter.length>100) s.meter=s.meter.slice(-100);
        }
        continue;
      }
      if (!['vfo','modulation','rx_enable','tx_enable'].includes(name) || !/^\d+$/.test(a[0])) continue;
      const s = this.slices[a[0]] ||= {rx:null, txFreq:null, mode:null, enabled:true, tx:false};
      if (name === 'vfo' && a.length === 3 && /^\d+$/.test(a[2]) && Number(a[2]) > 0) {
        if (a[1] === '0') { if(s.rx !== Number(a[2])) s.meter = []; s.rx = Number(a[2]); }
        if (a[1] === '1') s.txFreq = Number(a[2]);
      }
      if (name === 'modulation' && a.length === 2) { if(s.mode !== a[1].toUpperCase()) s.meter=[]; s.mode = a[1].toUpperCase(); }
      if (name === 'rx_enable' && ['true','false'].includes(a[1])) {
        if (a[1] === 'false') delete this.slices[a[0]];
        else s.enabled = true;
      }
      if (name === 'tx_enable' && ['true','false'].includes(a[1])) s.tx = a[1] === 'true';
    }
  }
  selected(selection='auto') {
    const entries = Object.entries(this.slices).filter(([,s])=>s.enabled);
    const entry = selection === 'auto' ? entries.find(([,s])=>s.tx) : entries.find(([id])=>id===selection);
    if (!entry || !this.running || !this.ready) return null;
    const [id,s] = entry;
    if (!s.rx || !s.mode) return null;
    const last = s.meter?.at(-1)?.time;
    const end = this.transmitting && last && Date.now()-last<=60000 ? last : Date.now();
    const samples = (s.meter || []).filter(p=>end-p.time<=5000);
    const signal = samples.length ? signalReport(Math.max(...samples.map(p=>p.dbm)),s.rx) : null;
    return {id, rx:s.rx, frequency:s.tx ? (s.txFreq || s.rx) : s.rx, mode:s.mode, drive:this.drive, signal};
  }
}
function logMode(mode) {
  return ({USB:'SSB',LSB:'SSB',CW:'CW',CWR:'CW',CWL:'CW',AM:'AM',SAM:'AM',FM:'FM',NFM:'FM',RTTY:'RTTY'})[mode] || '';
}
function signalReport(dbm, frequencyHz) {
  if (!Number.isFinite(dbm) || !Number.isFinite(frequencyHz) || frequencyHz<=0) return null;
  const s9 = frequencyHz < 30000000 ? -73 : -93;
  const strength = Math.max(1, Math.min(9,Math.round(9+(dbm-s9)/6)));
  const over = Math.max(0,Math.round(dbm-s9));
  return {dbm,strength,over,label:'S'+strength+(over?' +'+over+' dB':'')};
}
function withSignal(report, mode, strength) {
  if (!['SSB','CW','AM','FM'].includes(mode) || !/^[1-5][1-9][1-9]?$/.test(report)) return report;
  return report[0]+String(strength)+(mode==='CW'?(report[2] || '9'):'');
}
if (typeof module !== 'undefined') module.exports = {TciState,logMode,signalReport,withSignal};
