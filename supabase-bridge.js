/* A2L Supabase browser bridge. Publishable/anon key only; never put a secret key here. */
(() => {
  'use strict';
  const state = { url:'', key:'', client:null, ready:false };
  window.A2L_CONFIG = window.A2L_CONFIG || {};
  async function init(){
    try {
      const r=await fetch('/api/config',{cache:'no-store'});
      const cfg=await r.json();
      state.url=cfg.supabaseUrl||'';
      state.key=cfg.supabaseAnonKey||'';
      window.A2L_CONFIG={...window.A2L_CONFIG,supabaseUrl:state.url,supabaseAnonKey:state.key};
      if(window.supabase && state.url && state.key){
        state.client=window.supabase.createClient(state.url,state.key);
        state.ready=true;
        window.a2lSupabase=state.client;
      }
      window.dispatchEvent(new CustomEvent('a2l:supabase-ready',{detail:{configured:state.ready}}));
    } catch(e) {
      window.dispatchEvent(new CustomEvent('a2l:supabase-ready',{detail:{configured:false,error:e}}));
    }
  }
  window.a2lSupabaseState=state;
  init();
})();
