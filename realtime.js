/* Alone2Lone realtime bridge.
   Local BroadcastChannel/localStorage behavior is retained as a fallback for offline UI testing.
   When served by the Node server, Socket.IO becomes the cross-device transport.
*/
(function(){
  "use strict";

  function currentA2LId(){
    return String(window.state?.profile?.a2lId || "");
  }

  function handleEvent(event){
    if (!event || event.sender === currentA2LId()) return;
    if (typeof receiveA2L === "function") receiveA2L(event);
  }

  function emitA2L(type,payload){
    const event={
      id:"evt_"+Date.now()+"_"+Math.random().toString(36).slice(2),
      type,payload,sender:currentA2LId(),at:Date.now()
    };
    if (window.a2lSocket?.connected) {
      window.a2lSocket.emit("a2l:event", event);
      return;
    }
    try{
      if(window.BroadcastChannel){
        window.__a2lBC=window.__a2lBC||new BroadcastChannel("alone2lone-live-v1");
        window.__a2lBC.postMessage(event);
      }
    }catch(e){}
    try{
      localStorage.setItem("aloneToLoneLive",JSON.stringify(event));
      localStorage.removeItem("aloneToLoneLive");
    }catch(e){}
  }

  function setupSocket(){
    if(!window.io || !currentA2LId()) return;
    const socket=window.io({
      transports:["websocket","polling"],
      auth:{a2lId:currentA2LId()}
    });
    window.a2lSocket=socket;

    socket.on("connect",()=>{
      socket.emit("presence:set",{status:"online"});
      window.dispatchEvent(new CustomEvent("a2l:connected"));
      if(typeof toast==="function") toast("Connected to Alone2Lone ✓");
    });
    socket.on("disconnect",()=>{
      window.dispatchEvent(new CustomEvent("a2l:disconnected"));
    });

    socket.on("a2l:event", handleEvent);

    socket.on("chat:message",(m)=>{
      const from=String(m.from||"");
      if(!from || from===currentA2LId()) return;
      const id=Number(m.localPeerId || 0);
      let chatId=id;
      if(!chatId && Array.isArray(window.friends)){
        const f=window.friends.find(x=>String(x.a2lId)===from);
        chatId=Number(f?.id||0);
      }
      if(!chatId) return;
      state.chats=state.chats||{};
      const c=state.chats[chatId] ||= {
        messages:[],source:"friend",ended:false,locked:false,startedAt:Date.now()
      };
      c.messages=c.messages||[];
      c.messages.push({text:String(m.text||""),mine:false,at:Number(m.at)||Date.now(),status:"read"});
      if(typeof save==="function") save();
      if(typeof renderMessages==="function" && window.activeChatId===chatId) renderMessages(chatId);
      if(typeof renderChats==="function" && document.getElementById("chats")?.classList.contains("active")) renderChats();
      if(typeof toast==="function") toast("New message 💬");
    });

    socket.on("presence:update",(p)=>{
      const f=Array.isArray(window.friends) ? window.friends.find(x=>String(x.a2lId)===String(p.a2lId)) : null;
      if(f) f.online=p.status==="online";
      window.dispatchEvent(new CustomEvent("a2l:presence",{detail:p}));
    });

    socket.on("call:signal",(msg)=>{
      window.dispatchEvent(new CustomEvent("a2l:call-signal",{detail:msg}));
    });
  }

  try{
    if(window.BroadcastChannel){
      window.__a2lBC=new BroadcastChannel("alone2lone-live-v1");
      window.__a2lBC.onmessage=e=>handleEvent(e.data);
    }
  }catch(e){}
  window.addEventListener("storage",e=>{
    if(e.key!=="aloneToLoneLive"||!e.newValue)return;
    try{handleEvent(JSON.parse(e.newValue));}catch(err){}
  });

  window.addEventListener("DOMContentLoaded",()=>{
    setTimeout(setupSocket,0);
  });

  window.a2lEmit=emitA2L;

  // Existing prototype code calls emitA2L globally.
  window.emitA2L=emitA2L;
})();

function openModal(id){const m=$(id);if(!m)return;m.classList.add("show");m.setAttribute("aria-hidden","false")}
function closeModal(id){const m=$(id);if(!m)return;m.classList.remove("show");m.setAttribute("aria-hidden","true")}
let playTargetId=null,playGame="ttt",incomingRequestId=null;
let profileReturnPage="home",profileReturnChatId=null;
