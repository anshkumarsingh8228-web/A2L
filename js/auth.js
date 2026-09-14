/* Alone2Lone Supabase Auth bridge. Uses the existing Supabase project; never stores passwords. */
(function(){
  'use strict';
  let client=null,session=null;
  const $=id=>document.getElementById(id);
  const ready=(async()=>{
    try{
      const cfg=await fetch('/api/config',{cache:'no-store'}).then(r=>r.json());
      if(!cfg.supabaseUrl||!cfg.supabaseAnonKey)throw new Error('Supabase Auth is not configured');
      if(!window.supabase?.createClient)throw new Error('Supabase client unavailable');
      client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      const got=await client.auth.getSession();session=got.data.session||null;
      window.a2lAuth={client,getSession:()=>session,getAccessToken:()=>session?.access_token||'',signOut:()=>client.auth.signOut()};
      client.auth.onAuthStateChange((_e,s)=>{session=s||null;window.dispatchEvent(new CustomEvent('a2l:auth',{detail:{session}}));updateGate();});
      updateGate();
    }catch(e){console.warn('Supabase Auth:',e.message);window.a2lAuth={getSession:()=>null,getAccessToken:()=>''};updateGate(e.message);}
    return session;
  })();
  window.a2lAuthReady=ready;
  function updateGate(err){const gate=$('authGate');if(!gate)return;const signed=!!session;gate.hidden=signed;document.body.classList.toggle('auth-required',!signed);if(err)$('authError').textContent=err;}
  async function google(){try{if(!client)throw new Error('Authentication is not ready');$('authError').textContent='';const r=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}});if(r.error)throw r.error}catch(e){$('authError').textContent=e.message||'Google sign-in failed.'}}
  async function guest(){try{if(!client)throw new Error('Authentication is not ready');$('authGuest').disabled=true;$('authError').textContent='';const r=await client.auth.signInAnonymously();if(r.error)throw r.error}catch(e){$('authError').textContent=e.message||'Guest sign-in failed.'}finally{$('authGuest').disabled=false}}
  async function submit(mode){
    const email=$('authEmail').value.trim(),password=$('authPassword').value;
    if(!email||password.length<6){$('authError').textContent='Enter a valid email and a password of at least 6 characters.';return;}
    $('authSubmit').disabled=true;$('authError').textContent='';
    try{
      const r=mode==='signup'?await client.auth.signUp({email,password}):await client.auth.signInWithPassword({email,password});
      if(r.error)throw r.error;
      if(mode==='signup'&&!r.data.session)$('authError').textContent='Account created. Check your email to confirm, then sign in.';
      else $('authError').textContent='';
    }catch(e){$('authError').textContent=e.message||'Authentication failed.';}
    finally{$('authSubmit').disabled=false;}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    $('authSignIn')?.addEventListener('click',()=>{mode='signin';setMode();});
    $('authSignUp')?.addEventListener('click',()=>{mode='signup';setMode();});
    $('authSubmit')?.addEventListener('click',()=>submit(mode));
    $('authGoogle')?.addEventListener('click',google);
    $('authGuest')?.addEventListener('click',guest);
    $('authForm')?.addEventListener('submit',e=>{e.preventDefault();submit(mode)});
    $('authSignOut')?.addEventListener('click',()=>client?.auth.signOut());
  });
  let mode='signin';
  function setMode(){ $('authTitle').textContent=mode==='signup'?'Create your A2L account':'Welcome back'; $('authSubmit').textContent=mode==='signup'?'Create account':'Sign in'; $('authSwitch').textContent=mode==='signup'?'Already have an account? Sign in':'New here? Create an account'; $('authSwitch').onclick=()=>{mode=mode==='signup'?'signin':'signup';setMode()}; }
})();
