'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="session-token"]').content;
const radio = new TciState();
let socket, reconnect, config, qsoStart = null, pendingRecord = null, busy = false;
let lookupTimer, lookupVersion=0, lookupBusy=false, profile=null;
let qrzWindow=null, qrzWindowCall='';
function renderQrzButton() {
  if (qrzWindow?.closed) { qrzWindow=null; qrzWindowCall=''; }
  const open=!!qrzWindow;
  $('qrzPageButton').disabled=!open && !/^[A-Z0-9/]{3,20}$/.test($('call').value.trim());
  $('qrzPageButton').textContent=open?'QRZ sluiten · '+qrzWindowCall:'QRZ-pagina openen ↗';
}
$('qrzPageButton').addEventListener('click',()=> {
  if(qrzWindow && !qrzWindow.closed) {
    const closing=qrzWindow;
    closing.close();
    setTimeout(()=> {
      if(qrzWindow===closing && !closing.closed) message('Deze browser kan het aparte venster niet sluiten. Sluit het zelf en gebruik het logboek in Safari of Chrome voor openen en sluiten met dezelfde knop.',true);
      renderQrzButton();
    },350);
    renderQrzButton();
    return;
  }
  const call=$('call').value.trim();
  if(!/^[A-Z0-9/]{3,20}$/.test(call)) return;
  // Open in the click event so ordinary popup protection permits the window.
  // Keep a handle for closing, while removing the new page's access to this app.
  const popup=window.open('about:blank','AetherQrzStation','popup=yes,width=950,height=800,resizable=yes,scrollbars=yes');
  if(!popup) { message('Je browser blokkeert het QRZ-venster. Sta pop-ups voor deze lokale loginterface toe en klik opnieuw.',true); return; }
  try {
    popup.opener=null;
    popup.location.replace('https://www.qrz.com/db/'+encodeURIComponent(call));
    qrzWindow=popup; qrzWindowCall=call;
  } catch {
    popup.close(); message('Het QRZ-venster kon niet worden geopend. Probeer het logboek in Safari of Chrome.',true);
  }
  renderQrzButton();
});
const fieldNames={call:'QRZ-call',fname:'Voornaam',name:'Achternaam',name_fmt:'Volledige naam',nickname:'Roepnaam',
  addr1:'Straat/adres',addr2:'Plaats',state:'Staat',zip:'Postcode',country:'Adresland',land:'DXCC-land',
  grid:'Locator',lat:'Breedtegraad',lon:'Lengtegraad',dxcc:'DXCC',cqzone:'CQ-zone',ituzone:'ITU-zone',
  email:'E-mail',url:'Website',qslmgr:'QSL-manager',eqsl:'eQSL',lotw:'LoTW',mqsl:'Papieren QSL',
  county:'County',iota:'IOTA',geoloc:'Bron van de locatie',p_call:'Vorige call',aliases:'Andere calls',
  class:'Licentieklasse',efdate:'Licentie vanaf',expdate:'Licentie tot',moddate:'Laatst bijgewerkt',attn:'Adres t.a.v.'};
function profileList(fields) {
  const dl=document.createElement('dl');
  for(const [key,value] of Object.entries(fields)) {
    const dt=document.createElement('dt'), dd=document.createElement('dd');
    dt.textContent=fieldNames[key] || key; dd.textContent=value; dl.append(dt,dd);
  }
  return dl;
}
function showProfile(data) {
  profile=data; $('profile').hidden=!data;
  if(data) $('mapStation').value='current';
  if (!$('mapPanel').hidden) refreshContactMap();
  if (!data) return;
  const p=data.fields;
  $('profileCall').textContent=data.query+(p.call && p.call!==data.query?' · QRZ-profiel: '+p.call:'');
  $('profileName').textContent=p.name_fmt || [p.fname,p.name].filter(Boolean).join(' ') || 'Niet beschikbaar';
  $('profileCountry').textContent=p.land || p.country || 'Niet beschikbaar';
  $('profileQth').textContent=p.addr2 || 'Niet beschikbaar';
  $('profileLocation').textContent=[p.addr2,p.land || p.country,p.grid].filter(Boolean).join(' · ');
  const qsl=[];
  if (p.qslmgr && p.qslmgr.toUpperCase()!=='NONE') qsl.push('QSL via '+p.qslmgr);
  for(const [field,label] of [['lotw','LoTW'],['eqsl','eQSL'],['mqsl','Papieren QSL']]) {
    if (p[field]) qsl.push(label+': '+(['1','Y','YES'].includes(p[field].toUpperCase())?'ja': ['0','N','NO'].includes(p[field].toUpperCase())?'nee':p[field]));
  }
  $('profileQsl').textContent=qsl.join(' · ');
  $('profileFields').replaceChildren(...profileList(p).childNodes);
}
function stationVerified() {
  const p=profile?.fields;
  return !!(profile && profile.query===$('call').value.trim() && p &&
    (p.name_fmt || p.fname || p.name) && (p.land || p.country) && p.addr2);
}
function clearLookup() {
  clearTimeout(lookupTimer); lookupVersion++; lookupBusy=false; showProfile(null);
}
function scheduleLookup() {
  clearLookup();
  const call=$('call').value.trim();
  if (!config?.hasLookup) {
    $('lookupStatus').textContent='Stationsgegevens: stel je QRZ XML-login in bij Instellingen.'; return;
  }
  if (call.length<3) { $('lookupStatus').textContent='Stationsgegevens worden opgezocht zodra je een call invoert.'; return; }
  lookupBusy=true; $('lookupStatus').textContent='QRZ-stationsgegevens opzoeken…';
  lookupTimer=setTimeout(lookup,700);
}
async function lookup() {
  clearTimeout(lookupTimer);
  const version=++lookupVersion, call=$('call').value.trim();
  if (!call || !config?.hasLookup) { scheduleLookup(); renderRadio(); return; }
  lookupBusy=true; renderRadio();
  try {
    const data=await api('lookup',{call});
    if (version!==lookupVersion || call!==$('call').value.trim()) return;
    showProfile(data);
    $('lookupStatus').textContent=data.notice || 'QRZ-gegevens gevonden · controleer naam, land en QTH';
  } catch(error) {
    if (version!==lookupVersion) return;
    showProfile(null); $('lookupStatus').textContent=error.message;
  } finally { if (version===lookupVersion) lookupBusy=false; renderRadio(); }
}
$('lookupButton').addEventListener('click',lookup);
async function api(path, data) {
  const options = {headers:{'X-Token':token}};
  if (data !== undefined) { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
  const response = await fetch('/api/'+path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'De lokale interface antwoordt niet.');
  return result;
}
function message(text, error=false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function current() { return radio.selected($('slice').value); }
function validRadio() { return socket?.readyState === WebSocket.OPEN && current(); }
function renderRadio() {
  renderQrzButton();
  const previous = $('slice').value;
  const wanted = Object.keys(radio.slices).sort((a,b)=>Number(a)-Number(b));
  const existing = Array.from($('slice').options).slice(1).map(o=>o.value);
  if (wanted.join() !== existing.join()) {
    $('slice').replaceChildren(new Option('Volg TX-slice', 'auto'), ...wanted.map(id=>new Option('Slice '+id,id)));
    // Keep a removed selected slice unavailable instead of silently logging another.
    if (previous !== 'auto' && !wanted.includes(previous)) $('slice').add(new Option('Slice '+previous+' (niet beschikbaar)', previous));
    $('slice').value = previous;
  }
  const s = validRadio();
  $('connection').textContent = s ? '● TCI verbonden' : socket?.readyState === WebSocket.OPEN ? 'Wachten op radio' : 'TCI niet verbonden';
  $('connection').classList.toggle('connected', !!s);
  $('frequency').textContent = s ? (s.frequency/1e6).toFixed(6) : '—';
  $('radioMode').textContent = s?.mode || '—';
  $('rx').textContent = s ? 'Slice '+s.id+(s.rx!==s.frequency ? ' · RX '+(s.rx/1e6).toFixed(6)+' MHz' : ' · TX-frequentie') : 'Start AetherSDR en schakel TCI in';
  $('drive').textContent = s?.drive != null ? 'RF-instelling: '+s.drive+'%' : 'RF-instelling: —';
  const mapped = s ? logMode(s.mode) : '';
  const mode = $('mode').value || mapped;
  const analog = ['SSB','CW','AM','FM'].includes(mode);
  const signal = s?.signal;
  $('signalStatus').textContent = signal ? 'S-meter: '+signal.label+' · '+signal.dbm.toFixed(0)+' dBm · piek laatste 5 seconden. R en T beoordeel je zelf.' : 'S-meter: geen recente ontvangstmeting. R en T beoordeel je zelf.';
  if ($('autoSignal').checked && !analog) $('signalStatus').textContent += ' Voor deze mode blijft het rapport handmatig.';
  if ($('autoSignal').checked && analog && signal && !busy && !pendingRecord) $('sent').value = withSignal($('sent').value,mode,signal.strength);
  $('mode').options[0].textContent = mapped ? 'Automatisch · '+mapped : 'Kies logmode';
  $('modeHint').textContent = s && !mapped ? 'Bij DIGU/DIGL kies je zelf FT8, FT4 of de gebruikte digitale mode.' : 'Frequentie en mode volgen de radio. Vermogen in watt vul je zelf in.';
  const verified = stationVerified();
  $('logButton').disabled = busy || lookupBusy || !verified || !!pendingRecord || !config?.hasKey || !s || !($('mode').value || mapped) || !$('call').value.trim();
  $('verificationHint').textContent = lookupBusy ? 'Even wachten: de stationsgegevens worden opgezocht.' :
    verified ? 'Controleer hierboven naam, land en QTH. Klik daarna op Save in QRZ om deze verbinding op te slaan.' :
    profile ? 'Naam, land of QTH ontbreekt. Controleer je QRZ XML-toegang; opslaan is pas mogelijk met deze gegevens.' :
    config?.hasLookup ? 'Voer een call in. Controleer daarna naam, land en QTH voordat je opslaat.' :
    'Stel bij Instellingen je QRZ XML-login in om naam, land en QTH te controleren voordat je opslaat.';
  $('lookupButton').disabled = busy || lookupBusy || !config?.hasLookup || !$('call').value.trim();
  $('newQso').disabled = busy;
  $('qsoTime').textContent = qsoStart ? 'QSO-start: '+qsoStart.toISOString().slice(0,10)+' · '+qsoStart.toISOString().slice(11,19)+' UTC' : 'Starttijd wordt vastgelegd zodra je de call invoert.';
}
function connect() {
  clearTimeout(reconnect);
  if (socket) { socket.onclose = null; socket.close(); }
  radio.reset(); renderRadio();
  try { socket = new WebSocket(config.tciUrl); }
  catch { message('Ongeldig TCI-adres. Controleer de instellingen.',true); return; }
  const ws = socket;
  ws.onopen = renderRadio;
  ws.onmessage = event => { if (typeof event.data === 'string') { radio.ingest(event.data); renderRadio(); } };
  ws.onerror = () => {};
  ws.onclose = () => { if (socket !== ws) return; radio.reset(); renderRadio(); reconnect = setTimeout(connect,3000); };
  // No TCI commands: the server sends its state when this client connects.
}
function newQso() {
  clearLookup();
  qsoStart = null; pendingRecord = null;
  $('call').value = ''; $('comment').value = ''; message('');
  scheduleLookup(); $('call').focus(); renderRadio();
}
$('call').addEventListener('input', () => {
  $('call').value = $('call').value.toUpperCase().replace(/[^A-Z0-9/]/g,'');
  if (!qsoStart && $('call').value) qsoStart = new Date();
  scheduleLookup();
  // After an upload attempt retain the exact request until New connection.
  renderRadio();
});
for (const id of ['slice','mode']) $(id).addEventListener('change', renderRadio);
$('autoSignal').addEventListener('change',renderRadio);
$('sent').addEventListener('input',()=> { $('autoSignal').checked=false; });
$('newQso').addEventListener('click',newQso);
$('qsoForm').addEventListener('submit',event=>event.preventDefault());
$('call').addEventListener('keydown',event=> {
  if(event.key==='Enter') { event.preventDefault(); if(!lookupBusy) lookup(); }
});
$('logButton').addEventListener('click', async () => {
  const s = validRadio();
  if (busy || lookupBusy || !stationVerified() || !s || !config.hasKey) return;
  if (pendingRecord) { message('Deze verbinding is al aangeboden. Controleer de status hieronder; kies daarna Nieuwe verbinding.',true); return; }
  const mode = $('mode').value || logMode(s.mode);
  if (!mode) { message('Kies de gebruikte digitale mode.',true); return; }
  if ($('autoSignal').checked && ['SSB','CW','AM','FM'].includes(mode) && !s.signal) {
    message('Er is geen recente S-metermeting. Wacht op het tegenstation of schakel automatisch S uit en vul het rapport zelf in.',true); return;
  }
  if ($('autoSignal').checked && s.signal && ['SSB','CW','AM','FM'].includes(mode)) $('sent').value=withSignal($('sent').value,mode,s.signal.strength);
  pendingRecord = {id:crypto.randomUUID(), call:$('call').value.trim(), frequency:s.frequency/1e6,
    rxFrequency:s.rx/1e6, mode, time:(qsoStart || new Date()).toISOString(),
    sent:$('sent').value, received:$('received').value, power:$('power').value, comment:$('comment').value};
  if ($('autoSignal').checked && s.signal && ['SSB','CW','AM','FM'].includes(mode)) pendingRecord.signal = s.signal;
  busy = true; renderRadio(); message('Verbinding wordt naar QRZ verstuurd…');
  try {
    const result = await api('log',pendingRecord);
    if (result.status === 'ok') {
      const call = pendingRecord.call;
      newQso(); message(call+' · '+result.detail);
    } else {
      message(result.detail+(result.status==='failed' ? ' Kies Nieuwe verbinding om na correctie opnieuw te loggen.' : ''),true);
    }
  } catch (error) {
    message(error.message+' Controleer QRZ en je lokale log voordat je deze verbinding opnieuw aanbiedt.',true);
  } finally { busy = false; renderRadio(); await history(); }
});
$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  $('settingsMessage').textContent = '';
  try {
    config = await api('config',{station:$('station').value,tciUrl:$('tciUrl').value,
      key:$('key').value,rememberKey:$('rememberKey').checked,power:$('defaultPower').value,
      xmlUser:$('xmlUser').value,xmlPassword:$('xmlPassword').value,rememberXml:$('rememberXml').checked});
    $('key').value = ''; $('key').placeholder = 'Sleutel ingesteld; leeg laten om te behouden';
    $('xmlPassword').value=''; $('xmlPassword').placeholder=config.hasLookup?'Wachtwoord ingesteld; leeg laten om te behouden':'Wachtwoord voor stationsgegevens';
    $('power').value = config.power; $('settingsMessage').textContent = 'Opgeslagen';
    ownMapProfile=null; ownMapCall='';
    $('settings').open = false; connect(); scheduleLookup(); $('call').focus();
  } catch (error) { $('settingsMessage').textContent = error.message; }
});
async function history() {
  try {
    const records = await api('history');
    mapRecords=records; updateMapChoices();
    $('history').replaceChildren();
    if (!records.length) { const p = document.createElement('p'); p.className='hint'; p.textContent='Nog geen verbindingen gelogd.'; $('history').append(p); }
    for (const r of records) {
      const row = document.createElement('div'); row.className='historyItem';
      const call = document.createElement('div');
      const stationLink=document.createElement('a');
      stationLink.className='stationLink'; stationLink.textContent=r.call+' ↗';
      stationLink.href='https://www.qrz.com/db/'+encodeURIComponent(r.call);
      stationLink.target='_blank'; stationLink.rel='noopener noreferrer';
      stationLink.title='Open de QRZ-pagina van '+r.call;
      call.append(stationLink);
      const time=document.createElement('small'); time.textContent=new Date(r.time).toISOString().slice(0,16).replace('T',' ')+' UTC'; call.append(time);
      if(r.profile?.fields) {
        const p=r.profile.fields, name=document.createElement('small');
        name.textContent=p.name_fmt || [p.fname,p.name].filter(Boolean).join(' '); call.append(name);
        const details=document.createElement('details'), summary=document.createElement('summary');
        summary.textContent='Stationsgegevens'; details.append(summary,profileList(p)); call.append(details);
      }
      const info = document.createElement('div'); info.textContent=Number(r.frequency).toFixed(6)+' MHz';
      const mode=document.createElement('small'); mode.textContent=r.mode+(r.power !== '' ? ' · '+r.power+' W' : ''); info.append(mode);
      const status=document.createElement('div'); status.className='state'+(r.status==='ok'?'':' error');
      status.textContent=({ok:'✓ In QRZ',failed:'Geweigerd',uncertain:'Controleer QRZ'})[r.status] || r.status;
      status.title=r.detail; row.append(call,info,status); $('history').append(row);
    }
  } catch { message('Het lokale logboek kan niet worden gelezen. Controleer of het startvenster nog open is.',true); }
}
$('export').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/export',{headers:{'X-Token':token}});
    if (!response.ok) throw new Error('Download mislukt.');
    const url = URL.createObjectURL(await response.blob());
    const a=document.createElement('a'); a.href=url; a.download='aether-qrz-log.adi'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch (error) { message(error.message,true); }
});

let contactMap, contactLayers, mapLibrary, mapRecords=[], ownMapProfile=null, ownMapCall='', mapVersion=0;
function locatorPoint(grid) {
  grid=String(grid || '').trim().toUpperCase();
  if (!/^[A-R]{2}(?:[0-9]{2}(?:[A-X]{2}(?:[0-9]{2})?)?)?$/.test(grid)) return null;
  let lon=(grid.charCodeAt(0)-65)*20-180, lat=(grid.charCodeAt(1)-65)*10-90, w=20,h=10;
  if(grid.length>=4) { w=2; h=1; lon+=Number(grid[2])*w; lat+=Number(grid[3])*h; }
  if(grid.length>=6) { w/=24; h/=24; lon+=(grid.charCodeAt(4)-65)*w; lat+=(grid.charCodeAt(5)-65)*h; }
  if(grid.length===8) { w/=10; h/=10; lon+=Number(grid[6])*w; lat+=Number(grid[7])*h; }
  return [lat+h/2,lon+w/2];
}
function profilePoint(fields) {
  if(fields?.lat?.trim() && fields?.lon?.trim()) {
    const lat=Number(fields.lat), lon=Number(fields.lon);
    if(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180) return [lat,lon];
  }
  return locatorPoint(fields?.grid);
}
function distanceKm(a,b) {
  const r=Math.PI/180, dlat=(b[0]-a[0])*r, dlon=(b[1]-a[1])*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dlon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
function connectionArc(a,b) {
  const r=Math.PI/180;
  const vector=p=>[Math.cos(p[0]*r)*Math.cos(p[1]*r),Math.cos(p[0]*r)*Math.sin(p[1]*r),Math.sin(p[0]*r)];
  const u=vector(a),v=vector(b), angle=Math.acos(Math.max(-1,Math.min(1,u.reduce((sum,x,i)=>sum+x*v[i],0))));
  const result=[];
  for(let i=0;i<=64;i++) {
    const t=i/64;
    let point;
    if(Math.abs(Math.sin(angle))<1e-8) point=[a[0]+(b[0]-a[0])*t,a[1]+(((b[1]-a[1]+540)%360)-180)*t];
    else {
      const x=u.map((n,j)=>(n*Math.sin((1-t)*angle)+v[j]*Math.sin(t*angle))/Math.sin(angle));
      point=[Math.atan2(x[2],Math.hypot(x[0],x[1]))/r,Math.atan2(x[1],x[0])/r];
    }
    const previous=result.length?result[result.length-1][1]:a[1];
    while(point[1]-previous>180) point[1]-=360;
    while(point[1]-previous< -180) point[1]+=360;
    result.push(point);
  }
  return result;
}
function updateMapChoices() {
  const selected=$('mapStation').value || 'current';
  $('mapStation').replaceChildren(new Option('Huidig tegenstation','current'));
  for(const record of mapRecords) $('mapStation').add(new Option(record.call+' · '+new Date(record.time).toISOString().slice(0,16).replace('T',' ')+' UTC',record.id));
  $('mapStation').value=selected==='current' || mapRecords.some(r=>r.id===selected)?selected:'current';
}
function loadMapLibrary() {
  if(window.L) return Promise.resolve();
  if(!mapLibrary) mapLibrary=new Promise((resolve,reject)=> {
    const css=document.createElement('link'); css.rel='stylesheet'; css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    css.integrity='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='; css.crossOrigin=''; document.head.append(css);
    const script=document.createElement('script'); script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity='sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='; script.crossOrigin='';
    script.onload=()=>resolve(); script.onerror=()=> { script.remove(); css.remove(); mapLibrary=null; reject(new Error('De kaart kan niet laden. Controleer je internetverbinding en klik op Kaart bijwerken.')); };
    document.head.append(script);
  });
  return mapLibrary;
}
async function refreshContactMap() {
  const version=++mapVersion;
  $('mapDistance').textContent=''; $('mapLocations').textContent='';
  if(contactLayers) contactLayers.clearLayers();
  $('mapStatus').textContent='Locaties en kaart ophalen…';
  try {
    await loadMapLibrary();
    if(version!==mapVersion || $('mapPanel').hidden) return;
    const L=window.L;
    if(!contactMap) {
      contactMap=L.map('contactMap').setView([30,0],2);
      const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(contactMap);
      tiles.on('tileerror',()=> { $('mapStatus').textContent='Kaartachtergrond niet bereikbaar. De afstand en verbindingslijn blijven beschikbaar.'; });
      contactLayers=L.layerGroup().addTo(contactMap);
    }
    contactMap.invalidateSize();
    const manual=$('homeGrid').value.trim();
    let home=locatorPoint(manual);
    if(manual && !home) throw new Error('Vul een geldige eigen locator in, bijvoorbeeld JO22, JO22AB of JO22AB12.');
    if(!home) {
      if(!config?.hasLookup) throw new Error('Stel je QRZ XML-login in of vul je eigen QTH-locator in.');
      if(ownMapCall!==config.station || !ownMapProfile) {
        const data=await api('lookup',{call:config.station});
        if(version!==mapVersion) return;
        ownMapProfile=data; ownMapCall=config.station;
      }
      home=profilePoint(ownMapProfile.fields);
    }
    if(!home) throw new Error('QRZ heeft geen coördinaten voor jouw QTH. Vul hierboven je eigen locator in.');
    const selected=$('mapStation').value;
    const record=mapRecords.find(r=>r.id===selected);
    const target=selected==='current'?profile:record?.profile;
    const call=selected==='current'?$('call').value.trim():record?.call;
    const remote=profilePoint(target?.fields);
    const homeLabel=config.station+' · '+(manual || ownMapProfile?.fields?.addr2 || 'Eigen QTH');
    const label=text=> { const node=document.createElement('span'); node.textContent=text; return node; };
    L.circleMarker(home,{radius:7,color:'#24664e',fillColor:'#89dfbb',fillOpacity:1}).bindTooltip(label(homeLabel)).addTo(contactLayers);
    if(!remote || !call || (selected==='current' && target?.query!==call)) {
      contactMap.setView(home,6);
      throw new Error(call?'Geen coördinaten of locator voor '+call+'. Zoek de stationsgegevens op in het logboek.':'Voer een call in het logboek in of kies een recente verbinding.');
    }
    const arc=connectionArc(home,remote);
    L.polyline(arc,{color:'#2179b5',weight:3}).addTo(contactLayers);
    const endpoint=arc[arc.length-1];
    const destination=[call,target.fields.addr2,target.fields.land || target.fields.country].filter(Boolean).join(' · ');
    L.circleMarker(endpoint,{radius:7,color:'#174c72',fillColor:'#59baf7',fillOpacity:1}).bindTooltip(label(destination)).addTo(contactLayers);
    contactMap.fitBounds(L.latLngBounds(arc),{padding:[30,30],maxZoom:10});
    $('mapDistance').textContent='Afstand: '+Math.round(distanceKm(home,remote)).toLocaleString('nl-NL')+' km';
    $('mapLocations').textContent=homeLabel+' ↔ '+destination;
    $('mapStatus').textContent=manual?'Eigen QTH uit jouw locator · tegenstation uit QRZ':'Beide QTH-locaties uit QRZ';
  } catch(error) { if(version===mapVersion) $('mapStatus').textContent=error.message; }
}
function switchView(map) {
  $('logPanel').hidden=map; $('mapPanel').hidden=!map;
  $('logTab').setAttribute('aria-pressed',String(!map)); $('mapTab').setAttribute('aria-pressed',String(map));
  if(map) {
    if($('mapStation').value==='current' && !profile && mapRecords.length) $('mapStation').value=mapRecords[0].id;
    if(!$('homeGrid').value) { try { $('homeGrid').value=window.localStorage.getItem('qth-locator:'+config.station) || ''; } catch {} }
    refreshContactMap();
  } else { mapVersion++; }
}
$('logTab').addEventListener('click',()=>switchView(false));
$('mapTab').addEventListener('click',()=>switchView(true));
$('mapStation').addEventListener('change',refreshContactMap);
$('mapRefresh').addEventListener('click',()=> {
  try { window.localStorage.setItem('qth-locator:'+config.station,$('homeGrid').value.trim().toUpperCase()); } catch {}
  refreshContactMap();
});

function tick() {
  const now=new Date(); $('clock').textContent=now.toISOString().slice(11,19); $('date').textContent=now.toISOString().slice(0,10);
  renderRadio();
}
async function init() {
  tick(); setInterval(tick,1000);
  try {
    config=await api('config');
    $('station').value=config.station; $('tciUrl').value=config.tciUrl;
    $('rememberKey').checked=config.rememberKey; $('rememberXml').checked=config.rememberXml;
    $('xmlUser').value=config.xmlUser || '';
    $('xmlPassword').placeholder=config.hasLookup?'Wachtwoord ingesteld; leeg laten om te behouden':'Wachtwoord voor stationsgegevens';
    $('power').value=config.power; $('defaultPower').value=config.power;
    $('key').placeholder=config.hasKey?'Sleutel ingesteld; leeg laten om te behouden':'Vul hier je sleutel in';
    $('settings').open=!config.hasKey;
    connect(); scheduleLookup(); await history();
  } catch(error) { message(error.message,true); }
  renderRadio();
}
init();
