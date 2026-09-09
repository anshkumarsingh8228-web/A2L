/* Alone2Lone matching: Find Your Vibe + Quick Match. */
function getMatchPool(prefs){
  return friends.filter(f=>{
    if(state.blocked.includes(f.id))return false;
    if(prefs.online && !f.online)return false;
    if(prefs.age==="same" && f.ageGroup!==(state.profile.ageGroup||"16-17"))return false;
    if(prefs.interest!=="any" && !f.interests.includes(prefs.interest))return false;
    if(prefs.language!=="any"){
      const langs=f.languages||[];
      if(prefs.language==="both" ? !(langs.includes("english")&&langs.includes("hindi")) : !langs.includes(prefs.language)) return false;
    }
    return true;
  });
}
function openMatchModal(){
  const m=$("matchModal");if(!m)return;
  const p=state.matchPrefs||{};
  if($("matchLanguage"))$("matchLanguage").value=p.language||"any";
  if($("matchAge"))$("matchAge").value=p.age||"same";
  if($("matchInterest"))$("matchInterest").value=p.interest||"any";
  if($("matchOnline"))$("matchOnline").checked=p.online!==false;
  qsa("[data-match-mode]").forEach(b=>b.classList.toggle("selected",b.dataset.matchMode===p.mode));
  $("matchMode") && ($("matchMode").value=p.mode||"");
  $("matchResult") && ($("matchResult").innerHTML="");
  if($("matchFilterDrawer"))$("matchFilterDrawer").hidden=true;
  $("matchFiltersToggle")?.setAttribute("aria-expanded","false");
  if($("matchFilterChevron"))$("matchFilterChevron").textContent="⌄";
  m.classList.add("show");m.setAttribute("aria-hidden","false");
}
function closeMatchModal(){const m=$("matchModal");if(!m)return;m.classList.remove("show");m.setAttribute("aria-hidden","true");}
function startQuickMatchDirect(){
  if(state.privacy?.quickMatch===false){toast("Quick Match is turned off in Privacy settings.");return;}
  const prefs={mode:"video",language:"any",age:"same",interest:"any",online:true};
  let pool=getMatchPool(prefs);
  if(!pool.length){toast("No one is available for Quick Match right now.");return;}
  const f=pool[Math.floor(Math.random()*pool.length)];
  state.matchPrefs=prefs;save();toast("Finding a random video match… ✨");
  setTimeout(()=>window.a2lCall?.startMatch("video",f.id,"quick"),420);
}
document.addEventListener("click",e=>{
  const b=e.target.closest?.("[data-match-mode]");
  if(!b)return;
  const buttons=qsa("[data-match-mode]");
  buttons.forEach(x=>x.classList.toggle("selected",x===b));
  const mode=b.dataset.matchMode;
  state.matchPrefs=Object.assign({},state.matchPrefs,{mode});
  if($("matchMode"))$("matchMode").value=mode;
  save();
});

function randomFrom(arr){return arr[Math.floor(Math.random()*arr.length)]}
function quickMatch(){
  if(state.privacy?.search===false){toast("Find Your Vibe is turned off in Privacy settings.");return;}
  const selectedMode=qsa("[data-match-mode]").find(b=>b.classList.contains("selected"))?.dataset.matchMode || "";
  const mode=selectedMode || randomFrom(["video","voice","text"]);
  const languages=["any","english","hindi","both"];
  const ages=["same","any"];
  const interests=["any","Gaming","Music","Coding","Art","Movies","Reading","Sports","Travel","Photography","Memes"];
  const language=$("matchLanguage")?.value || "any";
  const age=$("matchAge")?.value || "same";
  const interest=$("matchInterest")?.value || "any";
  const prefs={
    mode,
    language:language==="any"?randomFrom(languages):language,
    age:age==="same"?"same":randomFrom(ages),
    interest:interest==="any"?randomFrom(interests):interest,
    online:$("matchOnline")?.checked!==false
  };
  // Never allow a random preference to make the matcher unnecessarily empty.
  let pool=getMatchPool(prefs);
  if(!pool.length && prefs.interest!=="any")pool=getMatchPool({...prefs,interest:"any"});
  if(!pool.length && prefs.language!=="any")pool=getMatchPool({...prefs,language:"any"});
  if(!pool.length && prefs.age!=="any" && prefs.age!=="same")pool=getMatchPool({...prefs,age:"any"});
  if(!pool.length){toast("No one is available right now.");return;}
  state.matchPrefs=prefs;save();
  const result=$("matchResult");
  if(result)result.innerHTML='<div class="a2l-match-result"><span class="a2l-match-spinner">✨</span><div><b>Finding your vibe…</b><div class="muted">Matching you with someone now.</div></div></div>';
  setTimeout(()=>{
    const f=pool[Math.floor(Math.random()*pool.length)];
    closeMatchModal();
    if(mode==="text"){
      state.chats[f.id]={messages:[],source:"quick",ended:false,locked:false,startedAt:Date.now(),matchPrefs:prefs};save();
      toast(`Match found: ${f.name} 💬`);setTimeout(()=>openChat(f.id),180);
    }else{
      toast(`Match found: ${f.name} ${mode==="video"?"📹":"🎙️"}`);
      setTimeout(()=>window.a2lCall?.startMatch(mode,f.id,"vibe"),180);
    }
  },500);
}
