/* A2L Phase 11 — Supabase Auth/session bridge */
(() => {
  const cfg = window.A2L_CONFIG || {};
  let accessToken = null;
  let user = null;

  async function loadSession() {
    if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      return {user:null, accessToken:null, configured:false};
    }
    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const {data,error} = await client.auth.getSession();
    if (error) return {user:null,accessToken:null,error};
    accessToken = data.session?.access_token || null;
    user = data.session?.user || null;
    window.a2lAuth.client = client;
    window.a2lAuth.user = user;
    window.a2lAuth.accessToken = accessToken;
    window.dispatchEvent(new CustomEvent("a2l:auth-changed",{detail:{user,accessToken}}));
    return {user,accessToken,configured:true};
  }

  window.a2lAuth = {
    client:null, user:null, accessToken:null,
    getUser(){ return this.user; },
    getAccessToken(){ return this.accessToken; },
    async refresh(){ return loadSession(); },
    async signOut(){ return this.client?.auth.signOut(); }
  };

  loadSession();
})();
