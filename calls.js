/* Compatibility adapter: the production call UI has one owner: realmatch.js. */
(function(){
  'use strict';
  function api(){return window.a2lRealMatch||null;}
  window.a2lCall={
    startMatch:(kind,id,source)=>api()?.startDirect && id ? api().startDirect(kind,id) : api()?.find?.(kind),
    startDirect:(kind,id)=>api()?.startDirect?.(kind,id),
    end:()=>api()?.end?.(true),
    next:()=>api()?.nextMatch?.(),
    showCallModal:()=>{},
    reset:()=>api()?.end?.(false)
  };
})();
