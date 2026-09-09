const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"]
});

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname, "..")));

const users = new Map(); // a2lId -> socket.id
const sockets = new Map(); // socket.id -> a2lId

function sendToUser(a2lId, event, payload){
  const socketId = users.get(String(a2lId));
  if(socketId) io.to(socketId).emit(event, payload);
  return !!socketId;
}

io.on("connection", socket => {
  const a2lId = String(socket.handshake.auth?.a2lId || "").trim();
  if(!a2lId){
    socket.disconnect(true);
    return;
  }

  const previous = users.get(a2lId);
  if(previous && previous !== socket.id) io.sockets.sockets.get(previous)?.disconnect(true);
  users.set(a2lId, socket.id);
  sockets.set(socket.id, a2lId);

  socket.emit("presence:update",{a2lId,status:"online"});

  socket.on("presence:set", ({status="online"}={})=>{
    io.emit("presence:update",{a2lId,status});
  });

  socket.on("a2l:event", event=>{
    if(!event || event.sender !== a2lId) return;
    const to = event.payload?.to;
    if(to) sendToUser(to,"a2l:event",event);
  });

  socket.on("chat:send", m=>{
    const to=String(m?.to||"");
    const text=String(m?.text||"").trim();
    if(!to || !text || text.length>5000) return;
    sendToUser(to,"chat:message",{
      from:a2lId,to,text,
      localPeerId:Number(m?.localPeerId||0),
      at:Number(m?.at)||Date.now()
    });
  });

  socket.on("call:invite", m=>{
    const to=String(m?.to||"");
    if(!to)return;
    sendToUser(to,"call:invite",{
      from:a2lId,to,kind:m.kind==="video"?"video":"voice",
      source:m.source||"call",fromName:String(m.fromName||"A2L user"),
      fromAvatar:String(m.fromAvatar||"🙂")
    });
  });

  socket.on("call:accept", m=>{
    const to=String(m?.to||""); if(to) sendToUser(to,"call:accepted",{from:a2lId});
  });
  socket.on("call:reject", m=>{
    const to=String(m?.to||""); if(to) sendToUser(to,"call:reject",{from:a2lId});
  });
  socket.on("call:busy", m=>{
    const to=String(m?.to||""); if(to) sendToUser(to,"call:busy",{from:a2lId});
  });
  socket.on("call:signal", m=>{
    const to=String(m?.to||""); if(!to)return;
    sendToUser(to,"call:signal",{...m,from:a2lId});
  });

  socket.on("disconnect",()=>{
    if(users.get(a2lId)===socket.id) users.delete(a2lId);
    sockets.delete(socket.id);
    io.emit("presence:update",{a2lId,status:"offline"});
  });
});

app.get("/health",(req,res)=>res.json({
  ok:true,
  service:"alone2lone-realtime",
  connectedUsers:users.size
}));

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Alone2Lone server listening on ${PORT}`));
