/* Alone2Lone cross-tab realtime demo layer. */

function emitA2L(type,payload){
  const event={id:"evt_"+Date.now()+"_"+Math.random().toString(36).slice(2),type,payload,sender:state.profile.a2lId,at:Date.now()};
  try{if(window.BroadcastChannel){window.__a2lBC=window.__a2lBC||new BroadcastChannel("alone2lone-live-v1");window.__a2lBC.postMessage(event)}}catch(e){}
  try{localStorage.setItem("aloneToLoneLive",JSON.stringify(event));localStorage.removeItem("aloneToLoneLive")}catch(e){}
}
function receiveA2L(event){if(!event||event.sender===state.profile.a2lId)return;const p=event.payload||{};
 if(event.type==="connection-request"&&p.to===state.profile.a2lId){state.connectionRequests[p.request.id]=p.request;save();showConnectionRequest(p.request);return}
 if(event.type==="chat-request"&&p.to===state.profile.a2lId){state.chatRequests=state.chatRequests||{};state.chatRequests[p.request.id]=p.request;save();if(typeof renderChats==="function"&&document.getElementById("chats")?.classList.contains("active"))renderChats();toast("New chat request 📩");return}
 if(event.type==="chat-response"&&p.to===state.profile.a2lId){const r=state.outgoingChatRequests?.[p.requestId];if(r){r.status=p.accepted?"accepted":"declined";if(p.accepted){const id=Number(r.toId);if(id){state.chats[id]=state.chats[id]||{messages:[],source:"request",ended:false,locked:false,startedAt:Date.now()};state.chats[id].source="request";state.chats[id].ended=false;state.chats[id].locked=false;}}save();if(typeof renderChats==="function")renderChats();toast(p.accepted?"Chat request accepted":"Chat request declined")}return}
 if(event.type==="connection-response"&&p.to===state.profile.a2lId){const req=Object.values(state.outgoingConnectionRequests||{}).find(r=>r.id===p.requestId);if(req){req.status=p.accepted?"accepted":"declined";if(p.accepted){const f=friends.find(x=>x.a2lId===req.to);if(f&&!state.connections.includes(f.id))state.connections.push(f.id);toast("Friend request accepted")}else toast("Connection request declined");save();if(activeChatId)refreshChatActionStates(activeChatId);renderProfile();if(typeof renderChats==="function")renderChats()};return}
 if(event.type==="play-request"&&p.to===state.profile.a2lId){state.playRequests[p.request.id]=p.request;save();showIncomingRequest(p.request);return}
 if(event.type==="play-response"&&p.to===state.profile.a2lId){const r=state.playRequests[p.requestId];if(r){r.status=p.accepted?"accepted":"declined";save();if(p.accepted)startSharedSession(r);else toast("Game request declined")};return}
 if(event.type==="play-session-update"&&p.to===state.profile.a2lId&&state.session?.requestId===p.requestId){const current=state.session,incoming=p.session;state.session={...current,...incoming,playerMark:current.playerMark,partnerCamera:incoming.camera,partnerMic:incoming.mic};save();if(document.querySelector("#gameplay.active"))renderSharedSession();return}
 if(event.type==="group-invite"&&p.to===state.profile.a2lId){state.groupRequests[p.request.id]=p.request;state.groupRooms[p.room.id]=p.room;save();showIncomingGroupInvite(p.request);return}
 if(event.type==="group-response"&&p.to===state.profile.a2lId){const req=Object.values(state.groupRequests||{}).find(r=>r.id===p.requestId);if(req){req.status=p.accepted?"accepted":"declined";save();toast(p.accepted?"Group invite accepted 👥":"Group invite declined")};return}
 if(event.type==="group-update"&&p.roomId){state.groupRooms[p.roomId]=p.room;save();if(state.session?.type==="group"&&state.session.roomId===p.roomId)renderGroupRoom(p.roomId)}
}
try{if(window.BroadcastChannel){window.__a2lBC=new BroadcastChannel("alone2lone-live-v1");window.__a2lBC.onmessage=e=>receiveA2L(e.data)}}catch(e){}
window.addEventListener("storage",e=>{if(e.key!=="aloneToLoneLive"||!e.newValue)return;try{receiveA2L(JSON.parse(e.newValue))}catch(err){}});
function openModal(id){const m=$(id);if(!m)return;m.classList.add("show");m.setAttribute("aria-hidden","false")}
function closeModal(id){const m=$(id);if(!m)return;m.classList.remove("show");m.setAttribute("aria-hidden","true")}
let playTargetId=null,playGame="ttt",incomingRequestId=null;
let profileReturnPage="home",profileReturnChatId=null;
