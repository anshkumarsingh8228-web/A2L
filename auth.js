/* Alone2Lone Supabase Auth bridge. Supports Supabase Auth and seamless guest/offline fallback. */
(function(){
  'use strict';
  let client=null,session=null;
  let authConfig={authRequired:false};
  const $=id=>document.getElementById(id);

  function getLocalGuestSession(){
    try{
      const raw=localStorage.getItem('aloneToLoneGuestSession');
      return raw?JSON.parse(raw):null;
    }catch{return null;}
  }
  function setLocalGuestSession(s){
    if(s)localStorage.setItem('aloneToLoneGuestSession',JSON.stringify(s));
    else localStorage.removeItem('aloneToLoneGuestSession');
  }

  const ready=(async()=>{
    try{
      const cfg=await fetch('/api/config',{cache:'no-store'}).then(r=>r.json()).catch(()=>({authRequired:false}));
      const hasSupabase=Boolean(cfg.supabaseUrl&&cfg.supabaseAnonKey&&window.supabase?.createClient);
authConfig=cfg||{authRequired:false};
      if(hasSupabase){
        client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{
          auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
        });
        const got=await client.auth.getSession();
        session=got.data.session||null;
        client.auth.onAuthStateChange((_e,s)=>{
          session=s||null;
          if(session)setLocalGuestSession(null);
          window.dispatchEvent(new CustomEvent('a2l:auth',{detail:{session}}));
          updateGate();
        });
        if(!session&&!hasSupabase){
  session=getLocalGuestSession();
}else if(hasSupabase){
  setLocalGuestSession(null);
      }

      if(!session&&cfg.authRequired===false&&!hasSupabase){
        // Auto-initialize guest session in zero-config dev mode
        const p=(typeof state!=='undefined'&&state.profile)||{};
        const id=p.a2lId||`guest_${Math.random().toString(36).slice(2,8)}`;
        session={
          access_token:'',
          email:`${id}@alone2lone.local`,user_metadata:{a2l_id:id,display_name:p.displayName||'Guest'}}
        };
        setLocalGuestSession(session);
      }

      window.a2lAuth={
        client,
        getSession:()=>session,
        getAccessToken:()=>session?.access_token||'',
        signOut:async()=>{
          setLocalGuestSession(null);
          session=null;
          if(client){try{await client.auth.signOut();}catch{}}
          window.dispatchEvent(new CustomEvent('a2l:auth',{detail:{session:null}}));
          updateGate();
        }
      };

      updateGate();
    }catch(e){
      console.warn('Auth initialization:',e.message);
      session=getLocalGuestSession();
      window.a2lAuth={
        client:null,
        getSession:()=>session,
        getAccessToken:()=>session?.access_token||'',
        signOut:async()=>{
          setLocalGuestSession(null);
          session=null;
          window.dispatchEvent(new CustomEvent('a2l:auth',{detail:{session:null}}));
          updateGate();
        }
      };
      updateGate();
    }
    return session;
  })();

  window.a2lAuthReady=ready;

  function updateGate(err){
    const gate=$('authGate');
    const signed=Boolean(session);
    if(gate)gate.hidden=signed;
    document.body.classList.toggle('auth-required',!signed);
    const signOutBtn=$('authSignOut');
    if(signOutBtn)signOutBtn.style.display=signed?'block':'none';
    if(err&&$('authError'))$('authError').textContent=err;
    else if(!err&&$('authError'))$('authError').textContent='';
  }

  async function google(){
    try{
      if(!client)throw new Error('Supabase Auth is not configured for Google sign-in.');
      $('authError').textContent='';
      const r=await client.auth.signInWithOAuth({
        provider:'google',
        options:{redirectTo:location.origin+location.pathname}
      });
      if(r.error)throw r.error;
    }catch(e){
      $('authError').textContent=e.message||'Google sign-in failed.';
    }
  }

  async function guest(){
    $('authGuest').disabled=true;
    $('authError').textContent='';
    try{
      if(client){
  const r=await client.auth.signInAnonymously();

  if(!r.error&&r.data?.session){
    session=r.data.session;
    updateGate();
    return;
  }

  if(authConfig.authRequired===true){
    throw new Error(
      r.error?.message ||
      'Guest sign-in is not enabled. Please sign in with your account.'
    );
  }
      }
      // Offline / guest fallback
      const p=(typeof state!=='undefined'&&state.profile)||{};
      const id=p.a2lId||`guest_${Math.random().toString(36).slice(2,8)}`;
      session={
        access_token:'',
        user:{id:`guest_uid_${id}`,email:`${id}@alone2lone.local`,user_metadata:{a2l_id:id,display_name:p.displayName||'Guest'}}
      };
      setLocalGuestSession(session);
      window.dispatchEvent(new CustomEvent('a2l:auth',{detail:{session}}));
      updateGate();
    }catch(e){
      $('authError').textContent=e.message||'Guest sign-in failed.';
    }finally{
      $('authGuest').disabled=false;
    }
  }

  async function submit(mode){
    const email=$('authEmail').value.trim(),password=$('authPassword').value;
    if(!email||password.length<6){
      $('authError').textContent='Enter a valid email and a password of at least 6 characters.';
      return;
    }
    if(!client){
      $('authError').textContent='Supabase Auth is not configured on the server.';
      return;
    }
    $('authSubmit').disabled=true;
    $('authError').textContent='';
    try{
      const r=mode==='signup'?await client.auth.signUp({email,password}):await client.auth.signInWithPassword({email,password});
      if(r.error)throw r.error;
      if(mode==='signup'&&!r.data.session)$('authError').textContent='Account created. Check your email to confirm, then sign in.';
      else $('authError').textContent='';
    }catch(e){
      $('authError').textContent=e.message||'Authentication failed.';
    }finally{
      $('authSubmit').disabled=false;
    }
  }

  let mode='signin';
  function setMode(){
    if($('authTitle'))$('authTitle').textContent=mode==='signup'?'Create your A2L account':'Welcome back';
    if($('authSubmit'))$('authSubmit').textContent=mode==='signup'?'Create account':'Sign in';
    if($('authSwitch'))$('authSwitch').textContent=mode==='signup'?'Already have an account? Sign in':'New here? Create an account';
  }

  document.addEventListener('DOMContentLoaded',()=>{
    $('authSignIn')?.addEventListener('click',()=>{mode='signin';setMode();});
    $('authSignUp')?.addEventListener('click',()=>{mode='signup';setMode();});
    $('authSubmit')?.addEventListener('click',()=>submit(mode));
    $('authGoogle')?.addEventListener('click',google);
    $('authGuest')?.addEventListener('click',guest);
    $('authForm')?.addEventListener('submit',e=>{e.preventDefault();submit(mode);});
    $('authSignOut')?.addEventListener('click',()=>window.a2lAuth?.signOut());
    $('authSwitch')?.addEventListener('click',()=>{mode=mode==='signup'?'signin':'signup';setMode();});
  });
})();
