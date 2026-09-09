/* A2L Phase 8 — separate realtime chat layer */
(() => {
  const CHAT_RECONNECT_MS = 2000;
  let ws = null, retryTimer = null;
  const listeners = new Set();

  function emit(message) {
    listeners.forEach(fn => { try { fn(message); } catch (_) {} });
  }

  function socketUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}`;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try { ws = new WebSocket(socketUrl()); } catch (_) { return; }

    ws.addEventListener("open", () => emit({type:"chat-socket-open"}));
    ws.addEventListener("message", e => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.type === "chat-message" || m.type === "chat-history" || m.type === "chat-error") emit(m);
    });
    ws.addEventListener("close", () => {
      emit({type:"chat-socket-closed"});
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, CHAT_RECONNECT_MS);
    });
  }

  window.a2lChat = {
    connect,
    on(fn) { if (typeof fn === "function") listeners.add(fn); return () => listeners.delete(fn); },
    send(conversationId, text, clientMessageId) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({
        type:"chat-message",
        conversationId:String(conversationId),
        text:String(text).trim().slice(0,2000),
        clientMessageId: clientMessageId || crypto.randomUUID()
      }));
      return true;
    },
    history(conversationId) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({type:"chat-history", conversationId:String(conversationId)}));
      return true;
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", connect);
  else connect();
})();
