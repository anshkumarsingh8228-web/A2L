/* A2L Auth — Supabase session bridge with anonymous guest fallback. */
(() => {
  'use strict';
  let accessToken = null;
  let user = null;
  let configured = false;

  async function clientReady() {
    if (window.a2lSupabaseState?.ready && window.a2lSupabase) return window.a2lSupabase;
    if (window.a2lSupabase) return window.a2lSupabase;
    return null;
  }

  async function loadSession({guestFallback=true}={}) {
    const client = await clientReady();
    if (!client) {
      window.dispatchEvent(new CustomEvent('a2l:auth-changed',{detail:{user:null,accessToken:null,configured:false}}));
      return {user:null,accessToken:null,configured:false};
    }
    configured = true;
    try {
      let sessionResult = await client.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      let session = sessionResult.data?.session || null;
      if (!session && guestFallback) {
        const anon = await client.auth.signInAnonymously();
        if (!anon.error) session = anon.data?.session || null;
      }
      accessToken = session?.access_token || null;
      user = session?.user || null;
      window.a2lAuth.client = client;
      window.a2lAuth.user = user;
      window.a2lAuth.accessToken = accessToken;
      window.a2lAuth.isAnonymous = !!user?.is_anonymous;
      window.dispatchEvent(new CustomEvent('a2l:auth-changed',{detail:{user,accessToken,configured:true,isAnonymous:!!user?.is_anonymous}}));
      return {user,accessToken,configured:true};
    } catch (error) {
      accessToken = null; user = null;
      window.a2lAuth.client = client;
      window.a2lAuth.user = null;
      window.a2lAuth.accessToken = null;
      window.dispatchEvent(new CustomEvent('a2l:auth-changed',{detail:{user:null,accessToken:null,configured:true,error}}));
      return {user:null,accessToken:null,configured:true,error};
    }
  }

  window.a2lAuth = {
    client:null, user:null, accessToken:null, isAnonymous:false,
    getUser(){ return this.user; },
    getAccessToken(){ return this.accessToken; },
    isSignedIn(){ return !!this.user; },
    async refresh(){ return loadSession({guestFallback:false}); },
    async signOut(){ const r=await this.client?.auth.signOut(); if(!r?.error){this.user=null;this.accessToken=null;} return r; }
  };

  window.addEventListener('a2l:supabase-ready',()=>loadSession(),{once:true});
  if (window.a2lSupabaseState?.ready) loadSession();
})();
