/* A2L Phase 4 compatibility bridge. The single live call engine is realmatch.js. */
(function(){
  'use strict';
  function api(){return window.a2lRealMatch||null;}
  window.a2lCall={
    showCallModal:function(){
      if(typeof window.a2lRealMatch?.find==='function') return window.a2lRealMatch.find('video');
    },
    startMatch:function(mode,id,source){
      if(typeof window.a2lRealMatch?.startDirect==='function') return window.a2lRealMatch.startDirect(mode,id);
      if(typeof window.a2lRealMatch?.find==='function' && (source==='quick'||source==='vibe')) return window.a2lRealMatch.find(mode||'video');
    },
    reset:function(){if(typeof window.a2lRealMatch?.end==='function')window.a2lRealMatch.end(true);}
  };
})();
