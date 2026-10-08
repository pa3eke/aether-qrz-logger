// Exercise the lookup → review → explicit save workflow without contacting QRZ.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {TciState,logMode,withSignal}=require('./tci.js');
class Element {
  constructor() { this.value=''; this.checked=false; this.options=[]; this.childNodes=[]; this.listeners={}; this.classList={toggle(){}}; }
  addEventListener(name,fn) { this.listeners[name]=fn; }
  replaceChildren(...nodes) { this.childNodes=nodes; this.options=nodes; }
  append(...nodes) { this.childNodes.push(...nodes); }
  add(node) { this.options.push(node); }
  focus() {}
  setAttribute(key,value) { this[key]=value; }
}
const elements={};
for(const match of fs.readFileSync('index.html','utf8').matchAll(/id="([^"]+)"/g)) elements[match[1]]=new Element();
elements.slice.value='auto'; elements.slice.options=[{value:'auto'}];
elements.mode.options=[{}]; elements.sent.value='59'; elements.received.value='59';
elements.autoSignal.checked=true;
const uploads=[];
let blocked=false, popup=null, opens=0;
const popupWindow={open:()=> {
  opens++;
  if(blocked) return null;
  popup={closed:false,opener:{},location:{replace(url){popup.url=url;}},close(){this.closed=true;}};
  return popup;
}};
class Socket { static OPEN=1; constructor(){this.readyState=1;} close(){} }
const context=vm.createContext({console,TciState,logMode,withSignal,Date,crypto:{randomUUID},WebSocket:Socket,window:popupWindow,
  document:{getElementById:id=>elements[id],querySelector:()=>({content:'test-token'}),createElement:()=>new Element()},
  Option:function(text,value){this.textContent=text;this.value=value;},setInterval(){},setTimeout(){},clearTimeout(){},
  fetch:async (path,options)=>{
    const body=options.body?JSON.parse(options.body):null;
    let result;
    if(path==='/api/config') result={station:'PA1XYZ',hasKey:true,hasLookup:true,tciUrl:'ws://127.0.0.1:50001',power:'100'};
    else if(path==='/api/history') result=[];
    else if(path==='/api/lookup') result={query:body.call,fields:{call:body.call,fname:'Test',name:'Operator',land:'Netherlands',addr2:'Utrecht'}};
    else if(path==='/api/log') { uploads.push(body); result={status:'ok',detail:'Opgeslagen'}; }
    else throw new Error('Unexpected request');
    return {ok:true,json:async()=>result};
  }});
vm.runInContext(fs.readFileSync('app.js','utf8'),context);
// Coordinates must never fall back to (0,0) when a QRZ field is absent.
assert.equal(vm.runInContext("profilePoint({lat:'',lon:''})",context),null);
assert.equal(vm.runInContext("locatorPoint('ZZ99')",context),null);
assert.equal(vm.runInContext("JSON.stringify(locatorPoint('JO22'))",context),'[52.5,5]');
assert.equal(vm.runInContext("JSON.stringify(profilePoint({lat:'0',lon:'0'}))",context),'[0,0]');
assert.ok(Math.abs(vm.runInContext('distanceKm([0,0],[0,90])',context)-10007.54)<0.1);
assert.equal(vm.runInContext('distanceKm([52,5],[52,5])',context),0);
assert.ok(vm.runInContext('connectionArc([10,179],[10,-179]).every((p,i,a)=>!i || Math.abs(p[1]-a[i-1][1])<180)',context),'Date-line route stays continuous');
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  vm.runInContext("radio.ingest('vfo:0,0,14292000;modulation:0,usb;tx_enable:0,true;start;ready;rx_smeter:0,-73;');",context);
  elements.call.value='PA0ABC'; elements.call.listeners.input();
  assert.equal(elements.logButton.disabled,true,'Cannot save before lookup');
  await vm.runInContext('lookup()',context);
  vm.runInContext('switchView(false)',context);
  assert.equal(elements.call.value,'PA0ABC','Switching views preserves entered call');
  assert.equal(elements.mapPanel.hidden,true);
  assert.equal(elements.logTab['aria-pressed'],'true');
  assert.equal(elements.profileName.textContent,'Test Operator');
  assert.equal(elements.profileCountry.textContent,'Netherlands');
  assert.equal(elements.profileQth.textContent,'Utrecht');
  assert.equal(elements.logButton.disabled,false,'Save enabled after station data');
  let prevented=false;
  elements.call.listeners.keydown({key:'Enter',preventDefault(){prevented=true;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(prevented); assert.equal(uploads.length,0,'Enter does not upload');
  await elements.logButton.listeners.click();
  assert.equal(uploads.length,1,'Explicit Save uploads once');
  assert.equal(uploads[0].call,'PA0ABC');
  assert.equal(elements.logButton.disabled,true,'New QSO needs verification again');
  elements.call.value='PA0ABC'; elements.call.listeners.input(); await vm.runInContext('lookup()',context);
  elements.call.value='PA0OTHER'; elements.call.listeners.input();
  assert.equal(elements.profile.hidden,true,'Old station disappears immediately');
  assert.equal(elements.logButton.disabled,true,'Changed call cannot reuse verification');
  await elements.logButton.listeners.click();
  assert.equal(uploads.length,1,'Unverified new call is not uploaded');
  elements.call.value='PA0ABC/P';
  elements.qrzPageButton.listeners.click();
  assert.equal(popup.url,'https://www.qrz.com/db/PA0ABC%2FP');
  assert.equal(popup.opener,null,'QRZ cannot access the local app');
  assert.match(elements.qrzPageButton.textContent,/QRZ sluiten/);
  elements.call.value=''; vm.runInContext('renderRadio()',context);
  assert.equal(elements.qrzPageButton.disabled,false,'Closing remains possible after clearing call');
  elements.qrzPageButton.listeners.click();
  assert.equal(popup.closed,true,'Second click closes window');
  assert.equal(opens,1,'Second click does not open another window');
  elements.call.value='PA0ABC'; elements.qrzPageButton.listeners.click(); popup.close();
  vm.runInContext('renderRadio()',context);
  assert.match(elements.qrzPageButton.textContent,/openen/,'Manual close resets button');
  blocked=true; elements.qrzPageButton.listeners.click();
  assert.match(elements.message.textContent,/blokkeert/,'Popup blocking is explained');
  console.log('Workflow passed: name/country/QTH preview, Enter only looks up, explicit Save, and call change resets verification.');
})().catch(error=>{console.error(error);process.exitCode=1;});
