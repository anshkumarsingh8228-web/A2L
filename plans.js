/* A2L Phase 10 — Free/Premium entitlement layer */
(() => {
  const DEFAULT_PLAN = "free";
  let plan = DEFAULT_PLAN;

  function setPlan(value) {
    plan = value === "premium" ? "premium" : "free";
    window.dispatchEvent(new CustomEvent("a2l:plan-changed", {detail:{plan}}));
  }

  window.a2lPlans = {
    get() { return plan; },
    isPremium() { return plan === "premium"; },
    can(feature) {
      const free = new Set([
        "quick-match",
        "random-video",
        "random-voice",
        "random-chat",
        "profile",
        "friends",
        "friend-chat",
        "friend-call",
        "reactions",
        "safety"
      ]);
      const premium = new Set(["specific-person-search","direct-connection","advanced-filters"]);
      return free.has(feature) || (premium.has(feature) && plan === "premium");
    },
    setForPrototype(value) { setPlan(value); }
  };
})();
