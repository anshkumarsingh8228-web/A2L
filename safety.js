/* A2L Phase 9 — Safety: block/report client layer */
(() => {
  const KEY = "a2l_safety_v1";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {blocked:[], reports:[]}; } catch (_) { return {blocked:[], reports:[]}; } };
  const save = s => localStorage.setItem(KEY, JSON.stringify(s));

  window.a2lSafety = {
    isBlocked(id) {
      if (!id) return false;
      return load().blocked.includes(String(id));
    },
    block(id, reason="") {
      if (!id) return false;
      const s=load(), key=String(id);
      if (!s.blocked.includes(key)) s.blocked.push(key);
      save(s);
      window.dispatchEvent(new CustomEvent("a2l:safety-changed",{detail:{type:"block",id:key}}));
      return true;
    },
    unblock(id) {
      const s=load(), key=String(id);
      s.blocked=s.blocked.filter(x=>x!==key); save(s);
      window.dispatchEvent(new CustomEvent("a2l:safety-changed",{detail:{type:"unblock",id:key}}));
    },
    report(id, category="other", details="") {
      if (!id) return false;
      const s=load();
      s.reports.push({
        targetId:String(id),
        category:String(category).slice(0,60),
        details:String(details).slice(0,1000),
        createdAt:Date.now()
      });
      save(s);
      window.dispatchEvent(new CustomEvent("a2l:safety-changed",{detail:{type:"report",id:String(id)}}));
      return true;
    },
    blockedIds() { return load().blocked.slice(); },
    localReports() { return load().reports.slice(); }
  };
})();
