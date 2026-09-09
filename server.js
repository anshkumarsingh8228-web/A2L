const path=require('path');
const fs=require('fs');
const http=require('http');
const express=require('express');
const {WebSocketServer}=require('ws');

const app=express();
const server=http.createServer(app);
const wss=new WebSocketServer({server});
const peers=new Map();
const waiting=new Map();

app.get('/health',(req,res)=>res.json({ok:true,service:'a2l-realtime'}));

// Serve the A2L project from the repository root.
app.get('/',(req,res)=>{
  const file=path.join(__dirname,'index.html');
  if(!fs.existsSync(file)) return res.status(404).send('A2L index.html not found');
  let html=fs.readFileSync(file,'utf8');
  // Load the real-user matching bridge after the normal A2L scripts.
  if(!html.includes('realmatch.js')) html=html.replace('</body>','<script src="/js/realmatch.js"></script></body>');
  res.type('html').send(html);
});

app.get('/css/style.css',(req,res)=>res.sendFile(path.join(__dirname,'style.css')));
app.get('/js/:file',(req,res)=>{
  const allowed=['hub.js','app.js','realtime.js','calls.js','games.js','profile.js','matching.js','chat.js','realmatch.js'];
  if(!allowed.includes(req.params.file)) return res.status(404).end();
  res.sendFile(path.join(__dirname,req.params.file));
});
app.use(express.static(__dirname));

function send(ws,msg){if(ws&&ws.readyState===1)ws.send(JSON.stringify(msg));}
function route(to,msg){const ws=peers.get(to);if(ws)send(ws,msg);}
function removeFromQueue(ws){for(const [mode,item] of waiting){if(item.ws===ws)waiting.delete(mode);}}

function queueMatch(ws,mode,name){
  mode=['video','voice'].includes(mode)?mode:'video';
  removeFromQueue(ws);
  const old=waiting.get(mode);
  if(old&&old.ws!==ws&&old.ws.readyState===1){
    waiting.delete(mode);
    send(old.ws,{type:'match-found',peerId:ws.a2lId,peerName:name||'A2L user',mode,initiator:true});
    send(ws,{type:'match-found',peerId:old.ws.a2lId,peerName:old.name||'A2L user',mode,initiator:false});
  }else{
    waiting.set(mode,{ws,name:name||'A2L user'});
    send(ws,{type:'waiting',mode});
  }
}

wss.on('connection',ws=>{
  let id=null;
  ws.a2lId=null;
  ws.name='A2L user';

  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}

    if(m.type==='register'&&m.a2lId){
      id=String(m.a2lId); ws.a2lId=id; ws.name=String(m.name||'A2L user');
      if(peers.has(id))send(peers.get(id),{type:'replaced'});
      peers.set(id,ws); send(ws,{type:'registered',a2lId:id}); return;
    }
    if(!id)return;

    if(m.type==='find-match'){
      queueMatch(ws,m.mode,m.profile?.name||ws.name); return;
    }
    if(m.type==='cancel-match'){removeFromQueue(ws);return;}
    if(m.to)route(String(m.to),{...m,from:id,fromName:ws.name});
  });

  ws.on('close',()=>{
    removeFromQueue(ws);
    if(id&&peers.get(id)===ws)peers.delete(id);
  });
});

const port=process.env.PORT||3000;
server.listen(port,'0.0.0.0',()=>console.log(`A2L server listening on ${port}`));
