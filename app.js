const DB_KEY='termos-state-v1';
const JSHELL_VERSION='1.3.0';
const defaultState=()=>({
  user:null, passwordHash:null, passwordDisabled:false,
  registry:{
    'HKEY_LOCAL_MACHINE':{'SYSTEM':{'Boot':{'BootDelay':'1200','SecureBoot':'Enabled'},'Display':{'Theme':'green','MaxClock':'100'}}},
    'HKEY_CURRENT_USER':{'Software':{'JShell':{'Version':'1.0.0','FirstBoot':'true'}}}
  },
  fs:{type:'dir',name:'/',children:{
    home:{type:'dir',name:'home',children:{}},
    etc:{type:'dir',name:'etc',children:{'os-release':{type:'file',name:'os-release',content:'NAME=JShell\nVERSION=1.0.0\nID=jshell\nHTML_BASED=1'}}},
    var:{type:'dir',name:'var',children:{log:{type:'dir',name:'log',children:{'boot.log':{type:'file',name:'boot.log',content:'',owner:'root',group:'root',mode:'0644'}}}}}
  }},
  cwd:'/home', history:[], logs:[], aliases:{},
  env:{TERM:'xterm-256color',SHELL:'/bin/jshell'},
  settings:{theme:'green',maxClock:100,secureBoot:true,bootDelay:1200,bootTarget:'JShellMain'},
  virtualRam:{total:1024,used:64,limit:4096},
  pkg:{repo:'',installed:{},updatedAt:null}
});
function loadState(){try{const raw=localStorage.getItem(DB_KEY);if(!raw)return defaultState();const s=deepMerge(defaultState(),JSON.parse(raw));if(s.settings?.bootTarget==='TermosMain')s.settings.bootTarget='JShellMain';if(s.env?.SHELL==='/bin/termsh')s.env.SHELL='/bin/jshell';const sw=s.registry?.HKEY_CURRENT_USER?.Software;if(sw?.TERMOS&&!sw.JShell){sw.JShell=sw.TERMOS;delete sw.TERMOS}const os=s.fs?.children?.etc?.children?.['os-release'];if(os?.content){os.content=os.content.replaceAll('NAME=TERMOS','NAME=JShell').replaceAll('ID=termos','ID=jshell')}return s}catch{return defaultState()}}
function saveState(s){localStorage.setItem(DB_KEY,JSON.stringify(s))}
function deepMerge(a,b){if(!b||typeof b!=='object')return a;const out={...a};for(const k of Object.keys(b)){if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k]))out[k]=deepMerge(a[k],b[k]);else out[k]=b[k]}return out}
async function sha256(text){const data=new TextEncoder().encode(text);const buf=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function resetState(){localStorage.removeItem(DB_KEY);location.reload()}
function getWebGLInfo(){try{const c=document.createElement('canvas');const gl=c.getContext('webgl')||c.getContext('experimental-webgl');if(!gl)return{};const dbg=gl.getExtension('WEBGL_debug_renderer_info');return{vendor:dbg?gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE)}}catch(e){return{error:String(e)}}}
function getHardwareSnapshot(){const nav=navigator;const conn=nav.connection||nav.mozConnection||nav.webkitConnection||{};return{
  browser:navigator.userAgent, uaData:navigator.userAgentData?`${navigator.userAgentData.brands?.map(x=>x.brand+' '+x.version).join(', ')} | mobile=${navigator.userAgentData.mobile}`:'Unavailable',
  platform:navigator.platform||'Unknown',vendor:navigator.vendor||'Unknown',language:navigator.language,languages:(navigator.languages||[]).join(', '),
  timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,cores:navigator.hardwareConcurrency??'Unavailable',deviceMemory:navigator.deviceMemory?`${navigator.deviceMemory} GB (approx)`:'Unavailable',
  maxTouch:navigator.maxTouchPoints??'Unavailable',online:navigator.onLine,connection:`${conn.effectiveType||'n/a'} down=${conn.downlink??'n/a'}Mb/s rtt=${conn.rtt??'n/a'}ms saveData=${!!conn.saveData}`,
  screen:`${screen.width}x${screen.height} @${window.devicePixelRatio}x`,viewport:`${innerWidth}x${innerHeight}`,
  colorDepth:screen.colorDepth,orientation:screen.orientation?.type||'Unknown',cookie: navigator.cookieEnabled,doNotTrack:navigator.doNotTrack||'Unset',pdfViewer:nav.pdfViewerEnabled??'Unavailable',
  storageEstimate:null, webgl:getWebGLInfo()
}}
async function enrichStorage(info){try{info.storageEstimate=await navigator.storage?.estimate?.()||null}catch{info.storageEstimate=null}return info}

class FPSMeter{
  constructor(onUpdate){this.onUpdate=onUpdate;this.frames=0;this.last=performance.now();this.current=0;this.raf=0}
  start(){const loop=(t)=>{this.frames++;if(t-this.last>=500){this.current=this.frames*1000/(t-this.last);this.frames=0;this.last=t;this.onUpdate?.(this.current)}this.raf=requestAnimationFrame(loop)};this.raf=requestAnimationFrame(loop)}
  stop(){cancelAnimationFrame(this.raf)}
}
async function benchmark(ms=700){const start=performance.now();let x=0,n=0;while(performance.now()-start<ms){x=Math.sin(n++)*Math.cos(n)*Math.sqrt(n+1)}return{ms:performance.now()-start,iterations:n,score:Math.round(n/(performance.now()-start)*1000),sink:x}}

const clone=o=>structuredClone(o);
class Kernel{
  constructor(state,host){
    this.state=state; this.host=host; this.bootAt=performance.now();
    this.nextPid=100; this.processes=new Map(); this.services=new Map();
    this.init();
  }
  init(){
    if(this.state.kernel?.processes?.length){
      for(const p of this.state.kernel.processes){ this.processes.set(p.pid,p); this.nextPid=Math.max(this.nextPid,p.pid+1); }
      for(const [id,s] of Object.entries(this.state.kernel.services||{})) this.services.set(id,s);
      if(this.processes.size===0) this.seed();
      return;
    }
    this.seed();
  }
  seed(){
    const base=[
      ['init','RUN','kernel',0,'root'],['jshell','RUN','shell',0,this.state.user||'user'],['renderer','RUN','renderer',0,'root'],['uefi-monitor','RUN','uefi-monitor',0,'root']
    ];
    for(const [name,state,cmd,ppid,owner] of base)this.spawn(name,{state,cmd,ppid,owner,system:true});
    const defs={network:'Network Manager',logger:'System Logger','web-runtime':'HTML/CSS/JS Runtime',cron:'Virtual Scheduler'};
    for(const [id,label] of Object.entries(defs)){const p=this.spawn(`svc:${id}`,{cmd:`service ${id}`,owner:'root',system:true});this.services.set(id,{id,label,status:'running',pid:p.pid});}
    this.persist();
  }
  spawn(name,opt={}){const p={pid:this.nextPid++,ppid:opt.ppid??1,name,state:opt.state||'RUN',cmd:opt.cmd||name,owner:opt.owner||this.state.user||'user',cpu:0,mem:Math.round(2+Math.random()*30),started:Date.now(),system:!!opt.system};this.processes.set(p.pid,p);return p}
  kill(pid,signal='TERM'){
    pid=Number(pid);const p=this.processes.get(pid);if(!p)return {ok:false,msg:`kill: (${pid}) - No such process`};
    if(p.system&&pid<=3)return {ok:false,msg:`kill: ${pid}: operation not permitted`};
    p.state=signal==='STOP'?'STOP':'TERM'; if(signal!=='STOP')setTimeout(()=>this.processes.delete(pid),0);this.persist();return {ok:true,msg:`[${pid}] ${signal}`};
  }
  resume(pid){const p=this.processes.get(Number(pid));if(!p)return false;p.state='RUN';this.persist();return true}
  service(name,action){const s=this.services.get(name);if(!s)return {ok:false,msg:`service: unknown service ${name}`};
    if(action==='status')return {ok:true,msg:`${s.id} - ${s.label}\n   Loaded: virtual\n   Active: ${s.status}`};
    if(['start','stop','restart'].includes(action)){
      if(action==='stop'){s.status='stopped';const p=this.processes.get(s.pid);if(p)p.state='STOP'}
      if(action==='start'){s.status='running';const p=this.processes.get(s.pid);if(p)p.state='RUN';else s.pid=this.spawn(`svc:${s.id}`,{cmd:`service ${s.id}`,owner:'root',system:true}).pid}
      if(action==='restart'){s.status='running';const p=this.processes.get(s.pid);if(p)p.state='RUN';else s.pid=this.spawn(`svc:${s.id}`,{cmd:`service ${s.id}`,owner:'root',system:true}).pid}
      this.persist();return {ok:true,msg:`${s.id}: ${s.status}`};
    }
    return {ok:false,msg:`service ${name}: usage status|start|stop|restart`};
  }
  list(){return [...this.processes.values()].sort((a,b)=>a.pid-b.pid).map(p=>({...p,age:Math.floor((Date.now()-p.started)/1000)}))}
  tick(){for(const p of this.processes.values()){if(p.state==='RUN'){p.cpu=+(Math.random()*4).toFixed(1);p.mem=Math.max(1,Math.round(p.mem+(Math.random()-.5)*2))}}}
  persist(){this.state.kernel={nextPid:this.nextPid,services:Object.fromEntries(this.services),processes:[...this.processes.values()]};saveState(this.state)}
}

function perms(node){return node?.mode|| (node?.type==='dir'?'0755':'0644')}
function chmodNode(node,mode){node.mode=String(mode).replace(/^0o/,''); if(!/^([0-7]{3}|[0-7]{4})$/.test(node.mode))throw new Error('invalid mode');}
function chownNode(node,user,group){node.owner=user;node.group=group||node.group||user}
function modeString(node){const m=perms(node).padStart(4,'0').slice(-3);const bits=m.split('').map(Number);const chars=['r','w','x'];return '-'+bits.map(v=>[4,2,1].map((b,i)=>v&b?chars[i]:'-').join('')).join('')}
function canWrite(node,user){if(user==='root')return true;return node.owner===user ? Number(perms(node).slice(-3, -2))>=6 : Number(perms(node).slice(-1))>=6}

/* ===== vi/editor.js ===== */
class ViEditor{
 constructor({state,term,path}){this.state=state;this.term=term;this.path=norm(path,term.cwd);this.n=node(state.fs,this.path);this.mode='NORMAL';this.line=0;this.col=0;this.dirty=false;this.old=term.host.term.innerHTML;this.open()}
 open(){if(!this.n||this.n.type!=='file'){this.term.print(`vi: ${esc(this.path)}: no such file`);return}this.overlay=document.createElement('div');this.overlay.className='vi-overlay';this.overlay.innerHTML=`<div class="vi-top">JShell vi · ${esc(this.path)} <span id="vi-mode">NORMAL</span></div><textarea id="vi-text" spellcheck="false"></textarea><div class="vi-status" id="vi-status"></div>`;document.body.appendChild(this.overlay);this.ta=this.overlay.querySelector('#vi-text');this.ta.value=this.n.content||'';this.ta.focus();this.update();this.onKey=e=>this.key(e);document.addEventListener('keydown',this.onKey,true);}
 update(){const lines=this.ta.value.split('\n');this.overlay.querySelector('#vi-mode').textContent=this.mode;this.overlay.querySelector('#vi-status').textContent=`${this.dirty?'[modified] ':''}${lines.length} lines · ${this.mode} · ESC normal · :w save · :q quit · :wq save+quit`}
 key(e){if(e.target!==this.ta)return;if(this.mode==='INSERT'){if(e.key==='Escape'){e.preventDefault();this.mode='NORMAL';this.update();return}this.dirty=true;return}
   if(e.key==='i'){e.preventDefault();this.mode='INSERT';this.update();return}
   if(e.key==='a'){e.preventDefault();this.mode='INSERT';this.ta.selectionStart=Math.min(this.ta.value.length,this.ta.selectionStart+1);this.ta.selectionEnd=this.ta.selectionStart;this.update();return}
   if(e.key==='j'){e.preventDefault();this.move(1);return} if(e.key==='k'){e.preventDefault();this.move(-1);return}
   if(e.key==='0'){e.preventDefault();this.ta.selectionStart=this.ta.selectionEnd=this.lineStart();return}
   if(e.key==='$'){e.preventDefault();this.ta.selectionStart=this.ta.selectionEnd=this.lineEnd();return}
   if(e.key===':'){e.preventDefault();this.commandPrompt();return}
 }
 move(d){const v=this.ta.value,pos=this.ta.selectionStart;const ls=v.slice(0,pos).split('\n');let row=ls.length-1,col=ls.at(-1).length;row=Math.max(0,Math.min(v.split('\n').length-1,row+d));const lines=v.split('\n');col=Math.min(col,lines[row].length);let p=0;for(let i=0;i<row;i++)p+=lines[i].length+1;p+=col;this.ta.selectionStart=this.ta.selectionEnd=p;}
 lineStart(){let p=this.ta.selectionStart;while(p>0&&this.ta.value[p-1]!=='\n')p--;return p}
 lineEnd(){let p=this.ta.selectionStart;while(p<this.ta.value.length&&this.ta.value[p]!=='\n')p++;return p}
 commandPrompt(){const c=prompt(':');if(c==='w'||c==='write'){this.save();}else if(c==='q'){if(this.dirty&&!confirm('Unsaved changes. Quit?'))return;this.close()}else if(c==='wq'||c==='x'){this.save();this.close()}else if(c==='q!'){this.close()}else if(c){this.term.print(`vi: unknown command: ${esc(c)}`)}this.update()}
 save(){this.n.content=this.ta.value;this.dirty=false;saveState(this.state);this.term.log(`vi: wrote ${this.path}`)}
 close(){document.removeEventListener('keydown',this.onKey,true);this.overlay?.remove();this.term.host.term.innerHTML=this.old;this.term.refreshPrompt();this.term.host.input?.focus()}
}

/* ===== terminal.js ===== */

const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function args(s){const a=[];let c='',q=null;for(let i=0;i<s.length;i++){const x=s[i];if(q){if(x===q)q=null;else if(x==='\\'&&i+1<s.length)c+=s[++i];else c+=x}else if(x==='"'||x==="'")q=x;else if(/\s/.test(x)){if(c){a.push(c);c=''}}else c+=x}if(c)a.push(c);return a}
const HELP_TEXT={
  ls:`ls — list directory contents\n\nUSAGE\n  ls [PATH]\n\nARGUMENTS\n  PATH       directory or file to list (default: current directory)\n\nOPTIONS\n  -h, --help show this help\n\nEXAMPLES\n  ls\n  ls /home\n  ls ~/user`,
  cd:`cd — change directory\n\nUSAGE\n  cd [PATH]\n\nARGUMENTS\n  PATH       target directory\n\nEXAMPLES\n  cd /home\n  cd ../`,
  pwd:`pwd — print the current directory\n\nUSAGE\n  pwd\n\nEXAMPLE\n  pwd`,
  cat:`cat — print file contents\n\nUSAGE\n  cat FILE [FILE ...]\n\nEXAMPLES\n  cat welcome.txt\n  cat /etc/os-release`,
  touch:`touch — create empty files\n\nUSAGE\n  touch FILE [FILE ...]\n\nEXAMPLE\n  touch notes.txt`,
  mkdir:`mkdir — create directories\n\nUSAGE\n  mkdir DIRECTORY [DIRECTORY ...]\n\nEXAMPLE\n  mkdir projects`,
  rm:`rm — remove files or directories\n\nUSAGE\n  rm PATH [PATH ...]\n\nEXAMPLE\n  rm old.txt`,
  cp:`cp — copy a file or directory\n\nUSAGE\n  cp SOURCE DESTINATION\n\nEXAMPLE\n  cp a.txt b.txt`,
  mv:`mv — move or rename a file\n\nUSAGE\n  mv SOURCE DESTINATION\n\nEXAMPLE\n  mv old.txt new.txt`,
  tree:`tree — show a directory tree\n\nUSAGE\n  tree [PATH]\n\nEXAMPLE\n  tree /home`,
  find:`find — find paths by name\n\nUSAGE\n  find PATH [NAME]\n\nEXAMPLES\n  find .\n  find /home notes`,
  ps:`ps — list virtual processes\n\nUSAGE\n  ps\n\nEXAMPLE\n  ps`,
  top:`top — show virtual CPU and memory usage\n\nUSAGE\n  top`,
  kill:`kill — stop a virtual process\n\nUSAGE\n  kill PID\n  kill -KILL PID\n\nARGUMENTS\n  PID        process ID`,
  pause:`pause — pause until Enter is pressed\n\nUSAGE\n  pause [MESSAGE]\n\nEXAMPLES\n  pause\n  pause Press Enter to continue...`,
  echo:`echo — print text\n\nUSAGE\n  echo TEXT...\n\nEXAMPLE\n  echo hello`,
  clear:`clear — clear the terminal\n\nUSAGE\n  clear`,
  history:`history — show command history\n\nUSAGE\n  history`,
  alias:`alias — create or show shell aliases\n\nUSAGE\n  alias\n  alias NAME=COMMAND`,
  export:`export — set an environment variable\n\nUSAGE\n  export NAME=VALUE`,
  env:`env — show environment variables\n\nUSAGE\n  env`,
  whoami:`whoami — print the current user\n\nUSAGE\n  whoami`,
  id:`id — show user and group IDs\n\nUSAGE\n  id`,
  uname:`uname — show JShell system information\n\nUSAGE\n  uname`,
  hostname:`hostname — print the JShell host name\n\nUSAGE\n  hostname`,
  date:`date — print the current date and time\n\nUSAGE\n  date`,
  uptime:`uptime — show session uptime\n\nUSAGE\n  uptime`,
  vi:`vi — open the virtual text editor\n\nUSAGE\n  vi FILE\n\nEXAMPLE\n  vi notes.txt`,
  chmod:`chmod — change virtual file permissions\n\nUSAGE\n  chmod MODE FILE\n\nEXAMPLE\n  chmod 755 script.js`,
  chown:`chown — change virtual file owner\n\nUSAGE\n  chown USER[:GROUP] FILE\n\nEXAMPLE\n  chown alice:alice notes.txt`,
  stat:`stat — show file metadata\n\nUSAGE\n  stat [PATH]`,
  service:`service — control virtual services\n\nUSAGE\n  service\n  service NAME status\n  service NAME start|stop|restart`,
  systemctl:`systemctl — alias for service\n\nUSAGE\n  systemctl NAME status|start|stop|restart`,
  info:`info — show browser/device information\n\nUSAGE\n  info`,
  cpu:`cpu — show detected logical CPU information\n\nUSAGE\n  cpu`,
  mem:`mem — show JS-visible and virtual memory information\n\nUSAGE\n  mem`,
  virtualram:`virtualram — inspect or configure virtual RAM\n\nUSAGE\n  virtualram [show|set SIZE]`,
  gpu:`gpu — show WebGL GPU information\n\nUSAGE\n  gpu`,
  net:`net — show network status\n\nUSAGE\n  net`,
  battery:`battery — show browser battery capability\n\nUSAGE\n  battery`,
  screen:`screen — show screen size and device scale\n\nUSAGE\n  screen`,
  fps:`fps — show terminal render FPS\n\nUSAGE\n  fps`,
  clock:`clock — show the virtual MAX CLOCK setting\n\nUSAGE\n  clock`,
  benchmark:`benchmark — run a JavaScript benchmark\n\nUSAGE\n  benchmark`,
  logs:`logs — show JShell logs\n\nUSAGE\n  logs [COUNT]\n  logs clear\n\nARGUMENTS\n  COUNT      number of recent lines (default: 30, maximum: 200)`,
  dmesg:`dmesg — show recent kernel-style messages\n\nUSAGE\n  dmesg`,
  uefi:`uefi — open JShell UEFI setup\n\nUSAGE\n  uefi`,
  reboot:`reboot — restart JShell\n\nUSAGE\n  reboot`,
  shutdown:`shutdown — stop JShell\n\nUSAGE\n  shutdown`,
  reg:`reg — inspect the virtual registry\n\nUSAGE\n  reg\n  reg list|get|set|del|export`,
  regedit:`regedit — virtual registry editor\n\nUSAGE\n  regedit`,
  html:`html — print an HTML file\n\nUSAGE\n  html FILE`,
  css:`css — print a CSS file\n\nUSAGE\n  css FILE`,
  js:`js — print a JavaScript file\n\nUSAGE\n  js FILE`,
  run:`run — preview an HTML file as a sandboxed app\n\nUSAGE\n  run FILE`,
  open:`open — open a virtual file/app\n\nUSAGE\n  open FILE`,
  execute:`execute — run an app without packaging it\n\nUSAGE\n  execute app/html "<!DOCTYPE JShellApp>..." [-n] [-f] [-c]\n  execute app/javascript "..." [-n] [-f] [-c]\n\nOPTIONS\n  -n  open the app in a new browser tab\n  -f  request fullscreen\n  -c  clear the JShell terminal before executing\n\nNOTES\n  app/html must start with <!DOCTYPE JShellApp>.\n  Multiple options can be combined, for example: -n -f -c\n\nEXAMPLES\n  execute app/html "<!DOCTYPE JShellApp><body><h1>Hello</h1></body>"\n  execute app/html "<!DOCTYPE JShellApp><body>...</body>" -n -f -c\n  execute app/javascript "document.body.innerHTML='<h1>Hello</h1>'" -n`,
  theme:`theme — change the terminal theme\n\nUSAGE\n  theme [NAME]\n\nEXAMPLE\n  theme green`,
  pkg:`pkg — JShell package manager\n\nUSAGE\n  pkg repo show\n  pkg repo set URL\n  pkg repo clear\n  pkg update\n  pkg search [TERM]\n  pkg info NAME\n  pkg install NAME|URL\n  pkg list\n  pkg files NAME\n  pkg run NAME\n  pkg remove NAME`,
  grep:`grep — filter piped input by text\n\nUSAGE\n  COMMAND | grep TEXT\n\nEXAMPLE\n  ls | grep txt`,
  head:`head — show the first lines of piped input\n\nUSAGE\n  COMMAND | head [COUNT]`,
  tail:`tail — show the last lines of piped input\n\nUSAGE\n  COMMAND | tail [COUNT]`,
  wc:`wc — count lines, words and characters in piped input\n\nUSAGE\n  COMMAND | wc`,
  sort:`sort — sort piped lines\n\nUSAGE\n  COMMAND | sort`,
  sleep:`sleep — wait for a short time\n\nUSAGE\n  sleep SECONDS`,
  neofetch:`neofetch — show a compact JShell system summary\n\nUSAGE\n  neofetch`,
  nyancat:`nyancat — show the JShell easter egg\n\nUSAGE\n  nyancat`
};
function generalHelp(){return `JShell commands\n\nFILESYSTEM\n  ls cd pwd cat touch mkdir rm cp mv tree find\n\nPROCESS\n  ps top tasks taskmgr kill jobs bg fg\n\nSHELL\n  echo clear history alias export env whoami id uname hostname date uptime\n  grep head tail wc sort sleep pause\n\nEDITOR / PERMISSIONS\n  vi vim chmod chown stat\n\nSERVICES / SYSTEM\n  service systemctl info cpu mem virtualram gpu net battery screen fps clock\n  benchmark logs dmesg uefi reboot shutdown\n\nREGISTRY / WEB\n  reg regedit html css js run open execute theme\n\nPACKAGE MANAGER\n  pkg\n\nHELP\n  command -h\n  command --help\n\nEXAMPLES\n  ls --help\n  cd --help\n  execute --help\n  pkg --help\n\nTip: every command supports -h or --help.`}
function splitPipe(s){const out=[];let c='',q=null;for(let i=0;i<s.length;i++){const x=s[i];if(q){c+=x;if(x===q)q=null;continue}if(x==='"'||x==="'"){q=x;c+=x}else if(x==='|'){out.push(c.trim());c=''}else c+=x}out.push(c.trim());return out}
function parseRedir(s){let q=null,idx=-1,op='';for(let i=0;i<s.length;i++){const x=s[i];if(q){if(x===q)q=null;continue}if(x==='"'||x==="'"){q=x;continue}if(x==='>'||x==='<'){idx=i;op=s.slice(i,i+2)==='>>'? '>>':x;break}}if(idx<0)return {cmd:s.trim()};return {cmd:s.slice(0,idx).trim(),op,file:s.slice(idx+op.length).trim()};}
function norm(p,cwd){const a=(p.startsWith('/')?p:cwd+'/'+p).split('/'),o=[];for(const x of a){if(!x||x==='.')continue;if(x==='..')o.pop();else o.push(x)}return '/'+o.join('/')}
function node(fs,p){if(p==='/')return fs;let n=fs;for(const x of p.split('/').filter(Boolean)){if(n.type!=='dir'||!n.children?.[x])return null;n=n.children[x]}return n}
const parent=p=>{const a=p.split('/').filter(Boolean);a.pop();return '/'+a.join('/')||'/'};
const base=p=>p.split('/').filter(Boolean).pop()||'/';

const pkgPath='/usr/local/pkg';
function ensureDir(fs,path,owner='root',group='root',mode='0755'){
  const parts=path.split('/').filter(Boolean);let cur=fs;
  for(const name of parts){if(!cur.children[name])cur.children[name]={type:'dir',name,children:{},owner,group,mode};if(cur.children[name].type!=='dir')throw new Error(`not a directory: /${parts.join('/')}`);cur=cur.children[name];}
  return cur;
}
function putVirtualFile(fs,path,content,owner='root',group='root',mode='0644'){
  const p=norm(path,'/'),par=ensureDir(fs,parent(p),owner,group);par.children[base(p)]={type:'file',name:base(p),content:String(content??''),owner,group,mode};
}
function normalizePkgName(name){return String(name||'').toLowerCase().replace(/[^a-z0-9._-]/g,'-').slice(0,64)}
function resolveUrl(base,url){try{return new URL(url,base||location.href).href}catch{return null}}
async function fetchJson(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json()}
function pkgIndexFrom(data){return Array.isArray(data?.packages)?data.packages:Array.isArray(data)?data:[]}
function pkgFind(installed,name){const key=normalizePkgName(name);return installed?.[key]||null}

class Terminal{
 constructor({state,host,onReboot,onShutdown,onUEFI}){this.state=state;this.host=host;this.onReboot=onReboot;this.onShutdown=onShutdown;this.onUEFI=onUEFI;this.fs=state.fs;this.cwd=state.cwd||'/home';this.env=state.env||{};this.aliases=state.aliases||{};this.state.pkg=this.state.pkg||{repo:'',installed:{},updatedAt:null};this.kernel=new Kernel(state,host);this.lastStatus=0;this.bootAt=performance.now();this.vi=null;this.paused=false;this.pauseResolver=null;ensureDir(this.fs,'/usr');ensureDir(this.fs,'/usr/local');ensureDir(this.fs,pkgPath);ensureDir(this.fs,'/var/lib');ensureDir(this.fs,'/var/lib/termos');ensureDir(this.fs,'/var/lib/termos/pkg');}
 start(){this.print(`<span class="ansi-bold">JShell ${JSHELL_VERSION}</span> · ${this.kernel.list().length} virtual processes`);this.print(`Logged in as ${esc(this.state.user)}. Type help.`);this.log('shell started');this.print('');this.refreshPrompt();return this}
 helpCommand(name=''){
  name=String(name||'').toLowerCase();
  if(!name)return {status:0,out:generalHelp()};
  const key=name==='vim'?'vi':name==='tasks'?'ps':name==='taskmgr'?'top':name==='systemctl'?'service':name==='regedit'?'reg':name;
  return {status:0,out:HELP_TEXT[key]||`No detailed help for '${name}'.\nTry: ${name} --help`};
 }
 internalPause(ms=0){return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)))}
 pauseCommand(message='Press Enter to continue...'){
  if(this.paused)return Promise.resolve({status:1,out:'pause: already paused'});
  this.paused=true;
  this.print(esc(String(message))+'\n[Press Enter to continue]');
  return new Promise(resolve=>{
    this.pauseResolver=()=>{
      this.paused=false;
      this.pauseResolver=null;
      this.print('');
      resolve({status:0,out:''});
    };
  });
 }
 resumePause(){if(this.pauseResolver)this.pauseResolver();else this.paused=false}
 print(t='',cls='cmdout'){const d=document.createElement('div');d.className='terminal-line '+cls;d.innerHTML=t;this.host.term.appendChild(d);this.host.scroll.scrollTop=this.host.scroll.scrollHeight}
 log(msg,level='info'){this.state.logs.push({ts:new Date().toISOString(),level,msg});if(this.state.logs.length>500)this.state.logs.shift();saveState(this.state)}
 refreshPrompt(){const home='/home/'+this.state.user;let path=this.cwd==='/'?'/':this.cwd===home?'~/'+this.state.user:this.cwd.startsWith(home+'/')?'~/'+this.state.user+this.cwd.slice(home.length):this.cwd.replace('/home','~');this.host.prompt.textContent=`${this.state.user}@jshell:${path}>`}
 async runLine(raw){if(this.paused)return;let line=raw.trim();if(!line)return;this.state.history.push(line);const execArgs=this.isExecuteLine(line)?args(line):[];if(execArgs.includes('-c'))this.host.term.innerHTML='';if(!(execArgs.includes('-c')&&execArgs.includes('-n')))this.print(`<span class="ansi-green">${esc(this.promptText())}</span> ${esc(line)}`);try{this.lastStatus=await this.executeShell(line)}catch(e){this.lastStatus=1;this.print(`<span class="ansi-red">${esc(e.message||e)}</span>`);await this.internalPause(120)}saveState(this.state);this.refreshPrompt();this.host.scroll.scrollTop=this.host.scroll.scrollHeight}
 promptText(){const home='/home/'+this.state.user;let path=this.cwd==='/'?'/':this.cwd===home?'~/'+this.state.user:this.cwd.startsWith(home+'/')?'~/'+this.state.user+this.cwd.slice(home.length):this.cwd.replace('/home','~');return `${this.state.user}@jshell:${path}>`}
 async executeShell(line){const pipes=splitPipe(line);let input='';let status=0;for(let i=0;i<pipes.length;i++){const r=parseRedir(pipes[i]);const a=args(r.cmd);if(!a.length)continue;const res=await this.command(a,input);status=res.status;input=res.out;if(r.op){const p=norm(r.file,this.cwd);if(r.op==='<' ){const n=node(this.fs,p);input=n?.content||''}else{if(!this.writeFile(p,input,r.op==='>>'))return 1;input=''}}if(i===pipes.length-1&&input!==''&&r.op!=='>'&&r.op!=='>>')this.print(esc(input));}return status}
 async command(a,input=''){let cmd=a.shift();if(this.aliases[cmd])a=args(this.aliases[cmd]).concat(a);cmd=cmd.toLowerCase();if(cmd==='help')return this.helpCommand(a[0]);if(a.includes('-h')||a.includes('--help'))return this.helpCommand(cmd);this.kernel.tick();
  switch(cmd){
   case 'help':return this.helpCommand(a[0]);
   case 'clear':this.host.term.innerHTML='';return {status:0,out:''};case 'echo':return {status:0,out:this.expand(a.join(' '))};case 'pwd':return {status:0,out:this.cwd};case 'whoami':return {status:0,out:this.state.user};case 'id':return {status:0,out:`uid=1000(${this.state.user}) gid=1000(${this.state.user}) groups=1000(${this.state.user})`};case 'uname':return {status:0,out:`JShell ${JSHELL_VERSION} jshell-kernel-js amd64 browser`};case 'hostname':return {status:0,out:'jshell'};case 'date':return {status:0,out:new Date().toString()};case 'uptime':return {status:0,out:`${Math.floor((performance.now()-this.bootAt)/1000)} seconds · ${this.kernel.list().length} processes`};
   case 'ls':return this.ls(a);case 'cd':return this.cd(a[0]||'/home');case 'cat':return this.cat(a);case 'touch':return this.touch(a);case 'mkdir':return this.mkdir(a);case 'rm':case 'rmdir':return this.rm(a);case 'cp':return this.cp(a);case 'mv':return this.mv(a);case 'tree':return this.tree(a[0]||this.cwd);case 'find':return this.find(a[0]||'.',a[1]||'');
   case 'history':return {status:0,out:this.state.history.map((x,i)=>`${String(i+1).padStart(4)}  ${x}`).join('\n')};case 'alias':return this.aliasCmd(a);case 'export':return this.exportCmd(a);case 'env':return {status:0,out:Object.entries(this.env).map(([k,v])=>`${k}=${v}`).join('\n')};
   case 'ps':case 'tasks':return this.ps();case 'top':case 'taskmgr':return this.top();case 'kill':return this.kill(a);case 'jobs':return {status:0,out:this.kernel.list().filter(p=>p.ppid!==0).map(p=>`[${p.pid}] ${p.state} ${p.cmd}`).join('\n')};case 'bg':return this.procState(a[0],'RUN');case 'fg':return this.procState(a[0],'RUN');
   case 'vi':case 'vim':this.vi=new ViEditor({state:this.state,term:this,path:a[0]||''});return {status:0,out:''};
   case 'chmod':return this.chmod(a);case 'chown':return this.chown(a);case 'stat':return this.stat(a);case 'service':case 'systemctl':return this.service(a);case 'pkg':return this.pkg(a);
   case 'pause':return this.pauseCommand(a.length?a.join(' '):'Press Enter to continue...');case 'virtualram':return this.virtualRam(a);case 'logs':return this.logs(a);case 'dmesg':return {status:0,out:this.state.logs.slice(-50).map(x=>`[${x.ts}] ${x.level.toUpperCase()} ${x.msg}`).join('\n')};case 'info':{const i=await enrichStorage(getHardwareSnapshot());return {status:0,out:JSON.stringify(i,null,2)}}case 'cpu':return {status:0,out:`logical CPUs: ${navigator.hardwareConcurrency??'n/a'}\ndeviceMemory: ${navigator.deviceMemory??'n/a'} GB hint`};case 'mem':{this.refreshVirtualRamUsage();return {status:0,out:`JS-visible memory hint: ${navigator.deviceMemory??'n/a'} GB\nVirtual RAM: ${this.state.virtualRam.used} MB used / ${this.state.virtualRam.total} MB\nVirtual RAM limit: ${this.state.virtualRam.limit} MB\nHost RAM cannot be added or changed by normal browser JavaScript.`}};case 'gpu':{const i=getHardwareSnapshot().webgl||{};return {status:0,out:`vendor: ${i.vendor||'n/a'}\nrenderer: ${i.renderer||'n/a'}\nversion: ${i.version||'n/a'}`}}case 'net':return {status:0,out:`online: ${navigator.onLine}\nconnection: ${navigator.connection?.effectiveType||'n/a'}`};case 'battery':return {status:0,out:'Battery API is browser-dependent; use info for detected capability.'};case 'screen':return {status:0,out:`${screen.width}x${screen.height} @${devicePixelRatio}x`};case 'fps':return {status:0,out:`terminal render FPS: ${this.host.fps().toFixed(0)}`};case 'clock':return {status:0,out:`virtual MAX CLOCK: ${this.state.settings.maxClock}%`};case 'benchmark':{const o=await benchmark();return {status:0,out:`${o.iterations.toLocaleString()} iterations / ${o.ms.toFixed(0)} ms / score ${o.score}`}}case 'neofetch':return {status:0,out:`   ██████  JShell\n  ██      ${JSHELL_VERSION}\n ██       ${this.state.user}\n  ██████  ${this.kernel.list().length} virtual processes\n     ██   ${navigator.hardwareConcurrency||'?'} CPU threads`};
   case 'reg':case 'regedit':return this.reg(a);case 'html':return this.web(a,'html');case 'css':return this.web(a,'css');case 'js':return this.web(a,'js');case 'execute':return this.executeApp(a);case 'run':return this.runFile(a[0]);case 'theme':this.theme(a[0]);return {status:0,out:`theme=${this.state.settings.theme||'green'}`};case 'open':return this.open(a[0]);
   case 'grep':return {status:0,out:input.split('\n').filter(x=>x.includes(a[0]||'')).join('\n')};case 'head':return {status:0,out:input.split('\n').slice(0,Number(a[0])||10).join('\n')};case 'tail':return {status:0,out:input.split('\n').slice(-(Number(a[0])||10)).join('\n')};case 'wc':return {status:0,out:`${input.split('\n').length} ${input.split(/\s+/).filter(Boolean).length} ${input.length}`};case 'sort':return {status:0,out:input.split('\n').sort().join('\n')};case 'sleep':await new Promise(r=>setTimeout(r,Math.min(5000,(Number(a[0])||1)*1000)));return {status:0,out:''};
   case 'uefi':this.onUEFI?.();return {status:0,out:''};case 'reboot':this.onReboot?.();return {status:0,out:'rebooting...'};case 'shutdown':this.onShutdown?.();return {status:0,out:'system halted'};case 'nyancat':this.nyancat();return {status:0,out:''};default:return {status:127,out:`${cmd}: command not found. Type help.`};
  }
 }
 expand(s){return s.replace(/\$(\w+)/g,(_,k)=>this.env[k]??'')}
 get(p){return node(this.fs,norm(p,this.cwd))}
 writable(p){const n=this.get(p);return !n||canWrite(n,this.state.user)}
 writeFile(p,data,append=false){const q=norm(p,this.cwd),par=node(this.fs,parent(q));if(!par||par.type!=='dir')return false;const b=base(q);if(par.children[b]&&par.children[b].type!=='file')return false;if(!par.children[b])par.children[b]={type:'file',name:b,content:'',owner:this.state.user,group:this.state.user,mode:'0644'};if(!this.writable(q))return false;par.children[b].content=append?par.children[b].content+data:data;saveState(this.state);return true}
 ls(a){const n=this.get(a[0]||this.cwd);if(!n)return {status:2,out:'ls: no such file'};if(n.type!=='dir')return {status:0,out:`${modeString(n)} ${n.owner||'root'} ${n.name}`};return {status:0,out:Object.values(n.children).sort((x,y)=>x.type.localeCompare(y.type)||x.name.localeCompare(y.name)).map(x=>`${modeString(x)} ${x.owner||'root'} ${x.name}${x.type==='dir'?'/':''}`).join('\n')}}
 cd(p){const n=this.get(p);if(!n||n.type!=='dir')return {status:1,out:'cd: directory not found'};this.cwd=norm(p,this.cwd);this.state.cwd=this.cwd;return {status:0,out:''}}
 cat(a){if(!a.length)return {status:1,out:'cat: missing file'};let out=[];for(const x of a){const n=this.get(x);if(!n||n.type!=='file')return {status:1,out:`cat: ${x}: not a file`};out.push(n.content||'')}return {status:0,out:out.join('\n')}}
 touch(a){for(const x of a){const p=norm(x,this.cwd),par=node(this.fs,parent(p));if(!par||par.type!=='dir')return {status:1,out:`touch: ${x}: parent not found`};if(!par.children[base(p)])par.children[base(p)]={type:'file',name:base(p),content:'',owner:this.state.user,group:this.state.user,mode:'0644'}}saveState(this.state);return {status:0,out:''}}
 mkdir(a){for(const x of a){const p=norm(x,this.cwd),par=node(this.fs,parent(p));if(!par||par.type!=='dir')return {status:1,out:`mkdir: ${x}: parent not found`};par.children[base(p)]={type:'dir',name:base(p),children:{},owner:this.state.user,group:this.state.user,mode:'0755'}}saveState(this.state);return {status:0,out:''}}
 rm(a){for(const x of a){const p=norm(x,this.cwd),par=node(this.fs,parent(p));if(!par?.children?.[base(p)])return {status:1,out:`rm: ${x}: not found`};delete par.children[base(p)]}saveState(this.state);return {status:0,out:''}}
 cp(a){if(a.length<2)return {status:1,out:'cp: usage cp SRC DST'};const s=this.get(a[0]),p=norm(a[1],this.cwd),par=node(this.fs,parent(p));if(!s||!par?.children)return {status:1,out:'cp: source or destination not found'};par.children[base(p)]=structuredClone(s);par.children[base(p)].name=base(p);saveState(this.state);return {status:0,out:''}}
 mv(a){const r=this.cp(a);if(r.status)return r;return this.rm([a[0]])}
 tree(p,d=0){const n=this.get(p);if(!n)return {status:1,out:'tree: path not found'};const out=[];const walk=(x,prefix='')=>{out.push(prefix+(x.name==='/'?'./':x.name+(x.type==='dir'?'/':'')));if(x.type==='dir'&&d<4)for(const c of Object.values(x.children).sort((a,b)=>a.name.localeCompare(b.name)))walk(c,prefix+'  ')};walk(n);return {status:0,out:out.join('\n')}}
 find(p,pat){const n=this.get(p);if(!n)return {status:1,out:'find: path not found'};const out=[];const walk=(x,q)=>{if(!pat||x.name.includes(pat))out.push(q);if(x.type==='dir')for(const c of Object.values(x.children))walk(c,q+(q==='/'?'':'/')+c.name)};walk(n,norm(p,this.cwd));return {status:0,out:out.join('\n')}}
 aliasCmd(a){if(!a.length)return {status:0,out:Object.entries(this.aliases).map(([k,v])=>`${k}='${v}'`).join('\n')};const [k,...v]=a;this.aliases[k]=v.join(' ');this.state.aliases=this.aliases;return {status:0,out:''}}
 exportCmd(a){for(const x of a){const m=x.match(/^([^=]+)=(.*)$/);if(m)this.env[m[1]]=m[2]}this.state.env=this.env;return {status:0,out:''}}
 ps(){const out=['PID  PPID USER     STATE CMD'];for(const p of this.kernel.list())out.push(`${String(p.pid).padEnd(5)}${String(p.ppid).padEnd(5)}${String(p.owner).padEnd(9)}${String(p.state).padEnd(6)}${p.cmd}`);return {status:0,out:out.join('\n')}}
 top(){return {status:0,out:this.kernel.list().map(p=>`${String(p.pid).padStart(4)} ${String(p.cpu).padStart(4)}% ${String(p.mem).padStart(4)}K ${p.state.padEnd(5)} ${p.owner.padEnd(8)} ${p.cmd}`).join('\n')}}
 kill(a){const r=this.kernel.kill(a[0],a[1]?.replace('-','').toUpperCase()==='KILL'?'KILL':'TERM');return {status:r.ok?0:1,out:r.msg}}
 procState(pid,s){if(!this.kernel.resume(pid))return {status:1,out:`${pid}: no such process`};return {status:0,out:`[${pid}] ${s}`}}
 chmod(a){if(a.length<2)return {status:1,out:'chmod: usage chmod MODE FILE'};const n=this.get(a[1]);if(!n)return {status:1,out:'chmod: file not found'};try{chmodNode(n,a[0]);saveState(this.state);return {status:0,out:''}}catch(e){return {status:1,out:e.message}}}
 chown(a){if(a.length<2)return {status:1,out:'chown: usage chown USER[:GROUP] FILE'};const n=this.get(a[1]);if(!n)return {status:1,out:'chown: file not found'};const [u,g]=a[0].split(':');chownNode(n,u,g);saveState(this.state);return {status:0,out:''}}
 stat(a){const n=this.get(a[0]||'.');if(!n)return {status:1,out:'stat: not found'};return {status:0,out:`File: ${a[0]||'.'}\nType: ${n.type}\nOwner: ${n.owner||'root'}\nGroup: ${n.group||n.owner||'root'}\nMode: ${perms(n)} (${modeString(n)})`}}
 service(a){if(!a.length)return {status:0,out:[...this.kernel.services.values()].map(s=>`${s.id.padEnd(16)} ${s.status}`).join('\n')};const r=this.kernel.service(a[0],a[1]||'status');return {status:r.ok?0:1,out:r.msg}}
 logs(a){if(a[0]==='clear'){this.state.logs=[];saveState(this.state);return {status:0,out:'logs cleared'}}const n=Math.min(200,Number(a[0])||30);return {status:0,out:this.state.logs.slice(-n).map(x=>`[${x.ts}] ${x.level.toUpperCase()} ${x.msg}`).join('\n')}}
 reg(a){if(!a.length)return {status:0,out:JSON.stringify(this.state.registry,null,2)};return {status:0,out:'registry editor: list|get|set|del|export (virtual registry)'}}
 pkg(a){
  const sub=(a[0]||'help').toLowerCase();
  if(sub==='help')return {status:0,out:`pkg - JShell package manager\n\nrepo:   pkg repo\n        pkg repo set URL\n        pkg repo clear\nupdate: pkg update\nsearch: pkg search [TERM]\ninfo:   pkg info NAME\ninstall:pkg install NAME|URL\nlist:   pkg list\nfiles:  pkg files NAME\nrun:    pkg run NAME\nremove: pkg remove NAME\n\nPackage repository format:\n  index.json -> {"packages":[{"name","version","description","url"}]}\n  package JSON -> {"name","version","type":"webapp","entry":"index.html","files":[{"path","content"}]}\nThe repository must allow CORS requests.`};
  if(sub==='repo'){
    const op=(a[1]||'show').toLowerCase();
    if(op==='show'||!a[1])return {status:0,out:`repository: ${this.state.pkg.repo||'(not configured)'}`};
    if(op==='set'){const u=resolveUrl(location.href,a[2]);if(!u)return {status:1,out:'pkg repo set: invalid URL'};this.state.pkg.repo=u;saveState(this.state);return {status:0,out:`repository set: ${u}`}}
    if(op==='clear'){this.state.pkg.repo='';saveState(this.state);return {status:0,out:'repository cleared'}}
    return {status:1,out:'pkg repo: usage show|set URL|clear'};
  }
  if(sub==='list'){
    const vals=Object.values(this.state.pkg.installed||{});if(!vals.length)return {status:0,out:'no packages installed'};
    return {status:0,out:vals.map(p=>`${p.name}@${p.version}  ${p.description||''}`).join('\n')};
  }
  if(sub==='search'){
    if(!this.state.pkg.repo)return {status:1,out:'pkg search: repository not configured. Use: pkg repo set URL'};
    return this.pkgFetchIndex().then(pkgs=>{const term=(a[1]||'').toLowerCase();const rows=pkgs.filter(p=>!term||`${p.name} ${p.description||''}`.toLowerCase().includes(term));return {status:0,out:rows.length?rows.map(p=>`${p.name}@${p.version||'?'}  ${p.description||''}`).join('\n'):'no matching packages'}}).catch(e=>({status:1,out:`pkg search: ${e.message}`}));
  }
  if(sub==='update')return this.pkgUpdate();
  if(sub==='info')return this.pkgInfo(a[1]);
  if(sub==='install')return this.pkgInstall(a[1]);
  if(sub==='files')return this.pkgFiles(a[1]);
  if(sub==='run')return this.pkgRun(a[1]);
  if(sub==='remove'||sub==='uninstall')return this.pkgRemove(a[1]);
  return {status:1,out:`pkg: unknown subcommand '${sub}'. Try: pkg help`};
 }
 async pkgFetchIndex(){
   if(!this.state.pkg.repo)throw new Error('repository not configured');
   const url=resolveUrl(this.state.pkg.repo,'index.json');
   const data=await fetchJson(url);return pkgIndexFrom(data);
 }
 async pkgUpdate(){
   try{const list=await this.pkgFetchIndex();this.state.pkg.updatedAt=new Date().toISOString();saveState(this.state);return {status:0,out:`repository updated: ${list.length} packages available\nrepo: ${this.state.pkg.repo}`}}catch(e){return {status:1,out:`pkg update: ${e.message}`}}
 }
 async pkgInfo(name){
   if(!name)return {status:1,out:'pkg info: usage pkg info NAME'};
   const installed=pkgFind(this.state.pkg.installed,name);if(installed)return {status:0,out:`Name: ${installed.name}\nVersion: ${installed.version}\nType: ${installed.type||'webapp'}\nDescription: ${installed.description||''}\nEntry: ${installed.entry||'(none)'}\nInstalled: ${installed.installedAt||''}`};
   try{const list=await this.pkgFetchIndex();const m=list.find(p=>p.name===name);if(!m)return {status:1,out:`pkg info: ${name}: package not found`};return {status:0,out:`Name: ${m.name}\nVersion: ${m.version||'?'}\nDescription: ${m.description||''}\nURL: ${resolveUrl(resolveUrl(this.state.pkg.repo,'index.json'),m.url)||m.url||''}`}}catch(e){return {status:1,out:`pkg info: ${e.message}`}}
 }
 async pkgInstall(spec){
   if(!spec)return {status:1,out:'pkg install: usage pkg install NAME|URL'};
   try{
     let meta=null,source='';
     if(/^https?:\/\//i.test(spec)){
       source=spec;meta=await fetchJson(spec);
     }else{
       const list=await this.pkgFetchIndex();meta=list.find(p=>p.name===spec);if(!meta)return {status:1,out:`pkg install: ${spec}: package not found`};source=resolveUrl(resolveUrl(this.state.pkg.repo,'index.json'),meta.url);if(!source)throw new Error('invalid package URL');meta=await fetchJson(source);
     }
     if(!meta?.name||!meta?.version||!Array.isArray(meta.files))throw new Error('invalid package manifest');
     const name=normalizePkgName(meta.name);const root=`${pkgPath}/${name}`;ensureDir(this.fs,root);for(const f of meta.files){if(!f?.path)continue;const rel=f.path.replace(/^\/+/, '').replace(/\.\.\//g,'');if(!rel||rel.startsWith('..'))continue;putVirtualFile(this.fs,`${root}/${rel}`,f.content??'')}
     this.state.pkg.installed[name]={name:meta.name,version:meta.version,type:meta.type||'webapp',description:meta.description||'',entry:meta.entry||'index.html',root,installedAt:new Date().toISOString(),source,files:meta.files.map(f=>f.path)};
     ensureDir(this.fs,`${'/usr/share/apps'}`);ensureDir(this.fs,`${'/usr/share/apps'}/${name}`);
     for(const f of meta.files){if(!f?.path)continue;putVirtualFile(this.fs,`/usr/share/apps/${name}/${f.path.replace(/^\/+/, '').replace(/\.\.\//g,'')}`,f.content??'')}
     saveState(this.state);return {status:0,out:`installed ${meta.name}@${meta.version}\nfiles: ${meta.files.length}\nrun: pkg run ${meta.name}`};
   }catch(e){return {status:1,out:`pkg install: ${e.message}`}}
 }
 pkgFiles(name){const p=pkgFind(this.state.pkg.installed,name);if(!p)return {status:1,out:`pkg files: ${name||''}: not installed`};return {status:0,out:(p.files||[]).map(x=>`/usr/share/apps/${normalizePkgName(p.name)}/${x}`).join('\n')}}
 async pkgRun(name){
   const p=pkgFind(this.state.pkg.installed,name);if(!p)return {status:1,out:`pkg run: ${name||''}: not installed`};
   if(p.type!=='webapp'&&p.type!=='htmlapp')return {status:1,out:`pkg run: unsupported package type ${p.type}`};
   const root=`/usr/share/apps/${normalizePkgName(p.name)}`;const entry=norm(`/${p.entry||'index.html'}`,root);const n=node(this.fs,entry);if(!n||n.type!=='file')return {status:1,out:`pkg run: entry not found: ${p.entry}`};
   let html=n.content||'';const css=(p.files||[]).filter(x=>/\.css$/i.test(x)).map(x=>node(this.fs,`${root}/${x.replace(/^\/+/, '')}`)?.content||'').join('\n');const js=(p.files||[]).filter(x=>/\.js$/i.test(x)).map(x=>node(this.fs,`${root}/${x.replace(/^\/+/, '')}`)?.content||'').join('\n');
   html=html.replace(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi,'');if(css)html=html.replace(/<\/head>/i,`<style>\n${css}\n</style></head>`);html=html.replace(/<script[^>]+src=["']([^"']+\.js)["'][^>]*><\/script>/gi,'');if(js)html=html.replace(/<\/body>/i,`<script>\n${js.replaceAll('</script>','<\\/script>')}\n<\/script></body>`);this.host.preview(html,'text/html');return {status:0,out:`sandboxed app: ${p.name}@${p.version}`};
 }
 pkgRemove(name){const p=pkgFind(this.state.pkg.installed,name);if(!p)return {status:1,out:`pkg remove: ${name||''}: not installed`};delete this.state.pkg.installed[normalizePkgName(p.name)];const appRoot=node(this.fs,`/usr/share/apps/${normalizePkgName(p.name)}`);if(appRoot){const par=node(this.fs,parent(`/usr/share/apps/${normalizePkgName(p.name)}`));if(par)delete par.children[normalizePkgName(p.name)]}const localRoot=node(this.fs,`${pkgPath}/${normalizePkgName(p.name)}`);if(localRoot){const par=node(this.fs,parent(`${pkgPath}/${normalizePkgName(p.name)}`));if(par)delete par.children[normalizePkgName(p.name)]}saveState(this.state);return {status:0,out:`removed ${p.name}`}}
 isExecuteLine(line){return /^execute\s+/i.test(String(line||''))}
 executeApp(a){
  const type=String(a.shift()||'').toLowerCase();
  if(type!=='app/html'&&type!=='app/javascript')return {status:2,out:'execute: usage execute app/html "CODE" [-n] [-f] [-c]'};
  const code=String(a.shift()??'');
  if(!code)return {status:2,out:'execute: missing application code'};
  const opts=new Set();
  for(const x of a){const z=String(x).toLowerCase();if(/^-[cnf]+$/.test(z))for(const ch of z.slice(1))opts.add(ch);}
  let html;
  if(type==='app/html'){
   if(!/^\s*<!doctype\s+(?:JShellApp|TermosApp)\b/i.test(code))return {status:2,out:'execute app/html: code must start with <!DOCTYPE JShellApp>'};
   html=code.replace(/^\s*<!doctype\s+(?:JShellApp|TermosApp)\s*>/i,'<!doctype html>');
  }else{
   html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script>\n'+code.replaceAll('</script>','<\\/script>')+'\n</script></body></html>';
  }
  if(opts.has('n')){
   const w=window.open('', '_blank');
   if(!w)return {status:1,out:'execute: new tab was blocked. Allow pop-ups for JShell.'};
   w.document.open();w.document.write(html);w.document.close();w.document.title='JShell App';
   if(opts.has('f'))setTimeout(()=>{try{w.document.documentElement.requestFullscreen?.()}catch{}},0);
   return {status:0,out:`executed ${type} in new tab${opts.has('f')?' + fullscreen':''}`};
  }
  this.host.preview(html,'text/html',opts.has('f'));
  return {status:0,out:`executed ${type}${opts.has('f')?' + fullscreen':''}`};
 }
 web(a,type){const p=a[0];if(!p)return {status:1,out:`${type}: usage ${type} FILE`};return this.cat([p])}
 runFile(p){const n=this.get(p||'');if(!n)return {status:1,out:'run: file not found'};this.host.preview(n.content,'text/html');return {status:0,out:`sandboxed preview: ${norm(p,this.cwd)}`}}
 theme(x){if(x)this.state.settings.theme=x;saveState(this.state);document.documentElement.dataset.theme=x||'green'}
 open(p){return this.runFile(p)}
 nyancat(){this.print(`<div class="nyan-wrap"><div class="starfield"></div><div class="rainbow">🌈🌈🌈🌈🌈</div><div class="nyan">🐱</div><div class="nyan-text">NYANCAT // JShell EASTER EGG</div></div>`);}
}

/* ===== uefi.js ===== */

class UEFI{
  constructor(state,{onExit}){
    this.state=state;this.onExit=onExit;this.tab='Main';
    this.tabs=['Main','Advanced','Boot','Security','Exit'];
    this.selected=0;this.info=null;this.fps=0;this.keyHandler=null;
    this.bootTarget=state.settings.bootTarget==='TermosMain'?'JShellMain':(state.settings.bootTarget||'JShellMain');
    this.bootDelay=state.settings.bootDelay==null?1200:state.settings.bootDelay;
    this.secureBoot=!!state.settings.secureBoot;
    this.maxClock=state.settings.maxClock||100;
    this.original={bootTarget:this.bootTarget,bootDelay:this.bootDelay,secureBoot:this.secureBoot,maxClock:this.maxClock};
    this.fpsMeter=new FPSMeter(f=>{this.fps=f;this.render()});
  }
  open(){
    this.info=getHardwareSnapshot();
    this.fpsMeter.start();
    const input=$('uefi-cmd');
    if(input) input.style.display='none';
    const row=input&&input.closest('.firmware-input-row');
    if(row) row.style.display='none';
    this.bind();
    this.render();
    // Storage probing must never block the UEFI screen on mobile Safari.
    enrichStorage(this.info).then(()=>this.render()).catch(()=>{});
  }
  close(){
    this.fpsMeter.stop();
    if(this.keyHandler)document.removeEventListener('keydown',this.keyHandler);
    const input=$('uefi-cmd');
    if(input) input.style.display='';
    const row=input&&input.closest('.firmware-input-row');
    if(row) row.style.display='';
  }
  getItems(){
    if(this.tab==='Main')return [
      {label:'System Information',value:'JShell 1.3.0'}
    ];
    if(this.tab==='Advanced')return [
      {label:'Virtual MAX CLOCK',value:this.maxClock+'%',change:(d)=>{this.maxClock=Math.max(10,Math.min(100,this.maxClock+d*5));}}
    ];
    if(this.tab==='Boot')return [
      {label:'Boot Target',value:this.bootTarget,change:(d)=>{this.bootTarget=this.bootTarget==='JShellMain'?'RecoveryBoot':'JShellMain';}},
      {label:'Boot Delay',value:this.bootDelay+' ms',change:(d)=>{this.bootDelay=Math.max(0,Math.min(10000,this.bootDelay+d*100));}}
    ];
    if(this.tab==='Security')return [
      {label:'Secure Boot (virtual)',value:this.secureBoot?'Enabled':'Disabled',change:()=>{this.secureBoot=!this.secureBoot;}}
    ];
    return [
      {label:'Save Changes and Exit',value:'Enter',action:()=>this.exit(true)},
      {label:'Discard Changes and Exit',value:'Enter',action:()=>this.exit(false)}
    ];
  }
  bind(){
    this.keyHandler=(e)=>{
      const screen=$('uefi');
      if(!screen||screen.classList.contains('hidden'))return;
      const k=e.key;
      if(k==='ArrowLeft'||k==='ArrowRight'||k==='ArrowUp'||k==='ArrowDown'||k==='Enter'||k==='Escape'||k==='F10')e.preventDefault();
      else return;
      if(k==='Escape'){this.exit(false);return;}
      if(k==='F10'){this.exit(true);return;}
      if(k==='ArrowLeft'||k==='ArrowRight'){
        const dir=k==='ArrowRight'?1:-1;
        this.tab=this.tabs[(this.tabs.indexOf(this.tab)+dir+this.tabs.length)%this.tabs.length];
        this.selected=0;this.render();return;
      }
      const items=this.getItems();
      if(k==='ArrowUp'){this.selected=(this.selected-1+items.length)%items.length;this.render();return;}
      if(k==='ArrowDown'){this.selected=(this.selected+1)%items.length;this.render();return;}
      if(k==='Enter'){
        const item=items[this.selected];
        if(item&&item.action){item.action();return;}
        if(item&&item.change){item.change(1);this.render();}
      }
    };
    document.addEventListener('keydown',this.keyHandler);
  }
  render(){
    const root=$('uefi-screen');
    if(!root)return;
    const info=this.info||{};const w=info.webgl||{};
    const vr=this.state.virtualRam||{total:1024,limit:4096};
    const items=this.getItems();
    if(this.selected>=items.length)this.selected=0;
    const bar=this.tabs.map(t=>t===this.tab?'['+t+']':' '+t+' ').join('  ');
    let lines=[];
    if(this.tab==='Main')lines=[
      'JShell UEFI SETUP UTILITY','',
      'OS                 JShell 1.3.0',
      'Firmware           UEFI-compatible JavaScript firmware',
      'CPU threads        '+(info.cores==null?'Unavailable':info.cores),
      'Device memory      '+(info.deviceMemory==null?'Unavailable':info.deviceMemory),
      'Platform           '+(info.platform||'Unknown'),
      'Screen             '+(info.screen||'Unknown'),
      'GPU renderer       '+(w.renderer||'Unavailable'),
      'Current FPS        '+this.fps.toFixed(0),''];
    if(this.tab==='Advanced')lines=[
      'Advanced Settings','',
      'CPU logical processors : '+(info.cores==null?'Unavailable':info.cores),
      'WebGL vendor           : '+(w.vendor||'Unavailable'),
      'WebGL renderer         : '+(w.renderer||'Unavailable'),
      'Virtual RAM            : '+vr.total+' MB / limit '+vr.limit+' MB',''];
    if(this.tab==='Boot')lines=['Boot Configuration','','Select the JShell startup target.',''];
    if(this.tab==='Security')lines=['Security Configuration','','User                 '+(this.state.user||'Not configured'),'Password             '+(this.state.passwordDisabled?'Disabled':'Enabled'),''];
    if(this.tab==='Exit')lines=['Exit Options','','Save or discard firmware settings.',''];
    for(let i=0;i<items.length;i++)lines.push((i===this.selected?'▶':' ')+' '+items[i].label.padEnd(29)+' : '+items[i].value);
    if(this.tab==='Boot')lines.push('','Boot Target: JShellMain | RecoveryBoot');
    lines.push('','↑↓ Select   ←→ Category   ENTER Change/Select   F10 Save   ESC Discard');
    root.textContent=bar+'                                      FPS '+this.fps.toFixed(0)+'\n'+'─'.repeat(Math.min(90,Math.max(40,window.innerWidth/9|0)))+'\n'+lines.join('\n');
    root.scrollTop=0;
  }
  exit(save){
    if(save){
      this.state.settings.bootTarget=this.bootTarget;
      this.state.settings.bootDelay=this.bootDelay;
      this.state.settings.secureBoot=this.secureBoot;
      this.state.settings.maxClock=this.maxClock;
      localStorage.setItem('termos-uefi-settings-v1',JSON.stringify({bootTarget:this.bootTarget,bootDelay:this.bootDelay,secureBoot:this.secureBoot,maxClock:this.maxClock}));
    }else{
      this.state.settings.bootTarget=this.original.bootTarget;
      this.state.settings.bootDelay=this.original.bootDelay;
      this.state.settings.secureBoot=this.original.secureBoot;
      this.state.settings.maxClock=this.original.maxClock;
    }
    this.close();
    if(this.onExit)this.onExit();
  }
}

/* ===== app bootstrap ===== */

const state=loadState();
let bootEnterCount=0,bootDone=false,bootTimer=null;
const $=id=>document.getElementById(id);
const bootLog=(msg)=>{const d=document.createElement('div');d.textContent=msg;$('boot-log').appendChild(d);state.logs.push({ts:new Date().toISOString(),level:'info',msg});saveState(state)};
function show(id){for(const x of ['boot','uefi','login','setup','os'])$(x).classList.toggle('hidden',x!==id)}
function applySettings(){try{const s=JSON.parse(localStorage.getItem('termos-uefi-settings-v1')||'{}');state.settings={...state.settings,...s}}catch{}}
function keepViewportTop(){window.scrollTo(0,0);document.documentElement.scrollTop=0;document.body.scrollTop=0}

function lowerCommandHead(value){if(!value)return value;const m=value.match(/^(\s*)([A-Z])/);return m?m[1]+m[2].toLowerCase()+value.slice(m[0].length):value}

function lockMobileViewport(){keepViewportTop();window.addEventListener('scroll',keepViewportTop,{passive:true});window.addEventListener('resize',keepViewportTop);window.visualViewport?.addEventListener('resize',keepViewportTop);document.addEventListener('focusin',keepViewportTop);document.addEventListener('touchmove',e=>{if(!e.target.closest('.terminal,.setup-terminal,.firmware-input-row,.vi-overlay'))e.preventDefault()},{passive:false})}
applySettings();
const info=getHardwareSnapshot();
let fpsMeter;
function boot(){show('boot');bootEnterCount=0;bootDone=false;const phases=['POST: CPU topology detected','Memory probe: browser deviceMemory hint','Display init: WebGL','Storage init: localStorage','Runtime init: JavaScript userspace','Kernel init: virtual process manager','JShell: userspace shell ready'];let p=0;bootLog('JShell BIOS 1.3.0 / UEFI-compatible firmware');bootLog('Booting JShell...  press ENTER 3x for UEFI.  press ESC for boot menu.');const onKey=e=>{if(bootDone)return;if(e.key==='Enter'){bootEnterCount++;if(bootEnterCount>=3){bootDone=true;clearInterval(bootTimer);document.removeEventListener('keydown',onKey);openUEFI(false);return}}if(e.key==='Escape'){bootDone=true;clearInterval(bootTimer);document.removeEventListener('keydown',onKey);showGrub();e.preventDefault()}};document.addEventListener('keydown',onKey);bootTimer=setInterval(()=>{if(bootDone)return;if(p<phases.length){bootLog(`[${String(Math.round((p/phases.length)*100)).padStart(3,' ')}%] ${phases[p++]}`)}else{bootDone=true;clearInterval(bootTimer);document.removeEventListener('keydown',onKey);setTimeout(continueBoot,180)}},150)}
function showGrub(){const grub=$('grub');grub.classList.remove('hidden');const items=['JShell OS 1.1.0','JShell Recovery / Safe Mode','UEFI Firmware Setup','Memory Diagnostic'];let selected=0;const render=()=>{$('grub-items').textContent=items.map((x,i)=>`${i===selected?'>':' '} ${x}`).join('\n')};render();const key=e=>{if(e.key==='ArrowDown'){selected=(selected+1)%items.length;render();e.preventDefault()}if(e.key==='ArrowUp'){selected=(selected+items.length-1)%items.length;render();e.preventDefault()}if(e.key==='F2'){cleanup();openUEFI(false);e.preventDefault()}if(e.key==='Enter'){cleanup();if(selected===2)openUEFI(false);else if(selected===3){bootLog('Memory diagnostic: browser-managed memory only.');setTimeout(()=>showGrub(),300)}else continueBoot();e.preventDefault()}};const cleanup=()=>{document.removeEventListener('keydown',key);grub.classList.add('hidden')};document.addEventListener('keydown',key)}
function openUEFI(fromOS=false){show('uefi');const u=new UEFI(state,{onExit:()=>fromOS?startOS():continueBoot()});u.open()}

function appendSetupLine(root,text=''){const d=document.createElement('div');d.textContent=text;root.appendChild(d)}
function startFirstBoot(){show('setup');const log=$('setup-log'),input=$('setup-cmd'),prompt=$('setup-prompt');log.innerHTML='';appendSetupLine(log,'JShell First Boot');appendSetupLine(log,'Create the local account for this browser profile.');appendSetupLine(log,'Username may contain A-Z a-z 0-9 . _ -');appendSetupLine(log,'');let step='user',user='',pass='',pass2='',disable=false;const set=(p,ph='')=>{prompt.textContent=p;input.value='';input.type=ph||'text';input.focus()};const finish=()=>{state.user=user;state.passwordDisabled=disable;state.passwordHash=disable?null:pass?null:null;state.cwd='/home/'+user;state.env.USER=user;state.virtualRam=state.virtualRam||{total:1024,used:64,limit:4096};const home=getNodeForSetup('/home');if(!home.children[user])home.children[user]={type:'dir',name:user,children:{'welcome.txt':{type:'file',name:'welcome.txt',content:'Welcome to JSHELL.\n',owner:user,group:user,mode:'0644'}}};saveState(state);if(disable){startOS();}else{sha256(pass).then(h=>{state.passwordHash=h;saveState(state);startOS()})}};const handler=e=>{if(e.key!=='Enter')return;e.preventDefault();const v=input.value.trim();if(step==='user'){if(!/^[A-Za-z0-9._-]+$/.test(v)){appendSetupLine(log,'Invalid username.');return}user=v;step='pass';appendSetupLine(log,`Username: ${user}`);set('Password: ','password');return}if(step==='pass'){pass=input.value;if(!pass){step='blank';appendSetupLine(log,'Blank password entered.');set('Use passwordless account? [Y/N]:');return}step='pass2';set('Confirm password: ','password');return}if(step==='blank'){const x=v.toLowerCase();if(x!=='y'&&x!=='n'){appendSetupLine(log,'Please answer Y or N.');return}if(x==='y'){disable=true;step='create';appendSetupLine(log,'Password: NONE');set('Create this account? [Y/N]:')}else{pass='';step='pass';set('Password: ','password')}return}if(step==='pass2'){pass2=input.value;if(pass!==pass2){appendSetupLine(log,'Passwords do not match.');return}step='disable';appendSetupLine(log,'Password confirmed.');set('Disable password protection? [Y/N]:');return}if(step==='disable'){const x=v.toLowerCase();if(x!=='y'&&x!=='n'){appendSetupLine(log,'Please answer Y or N.');return}disable=x==='y';step='create';appendSetupLine(log,`Disable password: ${disable?'YES':'NO'}`);set('Create this account? [Y/N]:');return}if(step==='create'){const x=v.toLowerCase();if(x==='y'){appendSetupLine(log,'Creating account...');input.disabled=true;document.removeEventListener('keydown',handler);finish()}else if(x==='n'){appendSetupLine(log,'Cancelled. Restarting First Boot.');step='user';user='';pass='';pass2='';disable=false;set('Username: ')}else appendSetupLine(log,'Please answer Y or N.')}};document.addEventListener('keydown',handler);set('Username: ')}
function continueBoot(){if(state.settings.bootTarget==='RecoveryBoot'){startOS(true);return}if(state.user)setupLogin();else startFirstBoot()}
function setupLogin(){show('login');const log=$('login-log'),input=$('login-cmd'),prompt=$('login-prompt');log.innerHTML='';appendSetupLine(log,'JShell login');appendSetupLine(log,state.passwordDisabled?'Password disabled.':'Authentication required.');let step='user';const set=(p,type='text')=>{prompt.textContent=p;input.value='';input.type=type;input.focus()};const handler=async e=>{if(e.key!=='Enter')return;e.preventDefault();const v=input.value.trim();if(step==='user'){if(v!==state.user){appendSetupLine(log,'Login incorrect.');return}appendSetupLine(log,`User: ${state.user}`);if(state.passwordDisabled){document.removeEventListener('keydown',handler);startOS();return}step='pass';set('Password: ','password');return}if(step==='pass'){const ok=await sha256(input.value)===state.passwordHash;if(ok){appendSetupLine(log,'Authentication successful.');document.removeEventListener('keydown',handler);startOS()}else{appendSetupLine(log,'Login incorrect.');input.value=''}}};document.addEventListener('keydown',handler);set('Username: ')}
function getNodeForSetup(p){let n=state.fs;for(const x of p.split('/').filter(Boolean)){n=n.children[x]}return n}
function startOS(recovery=false){show('os');const termScroll=$('terminal'),output=$('terminal-output');$('cmd').value='';if(recovery){const note=document.createElement('div');note.className='terminal-line';note.textContent='JShell RecoveryBoot: recovery session started.';output.appendChild(note);}fpsMeter=new FPSMeter(()=>{});fpsMeter.start();const host={term:output,scroll:termScroll,prompt:$('prompt'),input:$('cmd'),info:getHardwareSnapshot(),fps:()=>fpsMeter.current,uptimeText:()=>{return 'session active'},preview:(html,type,fullscreen=false)=>{const wrap=document.createElement('div');wrap.className='terminal-line';const frame=document.createElement('iframe');frame.style='display:block;width:100%;height:calc(100vh - 70px);min-height:320px;border:0;background:#fff';frame.setAttribute('allowfullscreen','');frame.sandbox='allow-scripts allow-forms allow-modals';frame.srcdoc=type==='text/html'?html:`<pre>${esc(html)}</pre>`;wrap.appendChild(frame);output.appendChild(wrap);termScroll.scrollTop=termScroll.scrollHeight;if(fullscreen)setTimeout(()=>{try{frame.requestFullscreen?.()}catch{}},0)}};const term=new Terminal({state,host,onReboot:()=>location.reload(),onShutdown:()=>shutdown(),onUEFI:()=>openUEFI(true)});term.start();wireInput(term);keepViewportTop()}
function wireInput(term){const inp=$('cmd'),scroll=$('terminal');inp.onkeydown=async e=>{if(term.paused){if(e.key==='Enter'){e.preventDefault();term.resumePause()}return}if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const v=inp.value;inp.value='';inp.style.height='17px';await term.runLine(v);scroll.scrollTop=scroll.scrollHeight;keepViewportTop();return}if(e.key==='ArrowUp'&&inp.value===''){const idx=Math.max(0,(state.history?.length||1)-1);inp.value=state.history[idx]||'';e.preventDefault()}if(e.key==='Escape'){inp.value=''}};inp.oninput=()=>{const pos=inp.selectionStart;const nv=lowerCommandHead(inp.value);if(nv!==inp.value){inp.value=nv;inp.selectionStart=inp.selectionEnd=pos}inp.style.height='auto';inp.style.height=Math.min(inp.scrollHeight,140)+'px';scroll.scrollTop=scroll.scrollHeight};inp.onfocus=()=>{scroll.scrollTop=scroll.scrollHeight;keepViewportTop()};setTimeout(()=>{scroll.scrollTop=scroll.scrollHeight;inp.focus()},50)}
function shutdown(){document.body.innerHTML='<pre style="margin:0;padding:20px;background:#000;color:#ddd;font:12px monospace">JSHELL\n\nSystem halted.\nIt is safe to close this tab.\n</pre>'}
lockMobileViewport();
boot();
