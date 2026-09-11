self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('message',e=>{
  const d=e.data||{};
  if(d.type==='incoming-call') self.registration.showNotification(d.title||'A2L Incoming Call',{body:d.body||'Someone is calling you',tag:'a2l-call',renotify:true,data:d}).catch(()=>{});
});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{if(cs[0])return cs[0].focus();return clients.openWindow('./');}));});
