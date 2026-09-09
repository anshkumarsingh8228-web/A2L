const path=require('path');
const http=require('http');
const express=require('express');
const {WebSocketServer}=require('ws');

const app=express();
const server=http.createServer(app);
const wss=new WebSocketServer({server});
const peers=new Map();

app.get('/health',(req,res)=>{
  res.json({ok:true,service:'a2l-realtime'});
});

// Serve the A2L project from the repository root.
app.get('/css/style.css',(req,res)=>{
  res.sendFile(path.join(__dirname,'style.css'));
});

app.get('/js/:file',(req,res)=>{
  const allowed=[
    'hub.js','app.js','realtime.js','calls.js',
    'games.js','profile.js','matching.js','chat.js'
  ];

  if(!allowed.includes(req.params.file)){
    return res.status(404).end();
  }

  res.sendFile(path.join(__dirname,req.params.file));
});

app.use(express.static(__dirname));

function send(ws,msg){
  if(ws.readyState===1) ws.send(JSON.stringify(msg));
}

function route(to,msg){
  const ws=peers.get(to);
  if(ws) send(ws,msg);
}

wss.on('connection',ws=>{
  let id=null;

  ws.on('message',raw=>{
    let m;
    try{
      m=JSON.parse(raw);
    }catch{
      return;
    }

    if(m.type==='register' && m.a2lId){
      id=String(m.a2lId);

      if(peers.has(id)){
        send(peers.get(id),{type:'replaced'});
      }

      peers.set(id,ws);
      send(ws,{type:'registered',a2lId:id});
      return;
    }

    if(!id) return;

    if(m.to){
      route(String(m.to),{...m,from:id});
    }
  });

  ws.on('close',()=>{
    if(id && peers.get(id)===ws){
      peers.delete(id);
    }
  });
});

const port=process.env.PORT || 3000;

server.listen(port,'0.0.0.0',()=>{
  console.log(`A2L server listening on ${port}`);
});
