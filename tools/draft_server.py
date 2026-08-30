#!/usr/bin/env python3
"""Local relay so a Claude Code session can think DURING the draft.

The VOR engine is a good valuation machine and a poor reader of context. It
cannot tell that "Questionable - Knee ACL" on a player with ADP 27 means the
market has already priced a recovery, that four quarterbacks going in six
picks is a room panicking, or that the guy two spots ahead of us just took
his second tight end and is now blocked. Those are judgement calls, and they
are exactly what gets lost if you walk into a draft with a frozen plan.

So the overlay pushes its state here every pick, a Claude session reads it,
thinks, and writes a short note back, and the overlay renders that note
beside the computed recommendation. The engine keeps the arithmetic; Claude
keeps the judgement; the human makes the pick.

    python3 tools/draft_server.py            # then draft

Endpoints
    POST /state   overlay  -> server   full draft state
    GET  /state   Claude   <- server   latest state (+ ?wait=1 long-poll)
    POST /note    Claude   -> server   {"text": "...", "pick": 34}
    GET  /note    overlay  <- server   latest note
    GET  /log     anyone   <- server   every state seen this session
"""
import json, os, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("DRAFT_PORT", "8830"))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_PATH = os.path.join(ROOT, "data", "draft_log.jsonl")

_lock = threading.Lock()
_state = {"pick": None, "updated": 0}
_note = {"text": "", "pick": None, "updated": 0}
_seen_picks = set()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, payload, ctype="application/json"):
        body = (json.dumps(payload) if ctype == "application/json"
                else payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # The overlay runs on https://football.fantasysports.yahoo.com and
        # talks to us through the userscript's GM_xmlhttpRequest, but allow
        # plain CORS too so a localhost page can drive it as well.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/state":
            with _lock:
                self._send(200, _state)
        elif path == "/note":
            with _lock:
                self._send(200, _note)
        elif path == "/log":
            try:
                with open(LOG_PATH) as f:
                    lines = f.read().strip().split("\n")
            except OSError:
                lines = []
            self._send(200, {"count": len(lines), "entries": lines[-50:]})
        elif path == "/":
            self._send(200, "draft relay up. POST /state, GET /state, "
                            "POST /note, GET /note\n", "text/plain")
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._send(400, {"error": "bad json"})
        path = self.path.split("?")[0]
        if path == "/state":
            data["updated"] = time.time()
            with _lock:
                _state.clear()
                _state.update(data)
                pick = data.get("pick")
                new = pick is not None and pick not in _seen_picks
                if new:
                    _seen_picks.add(pick)
            if new:
                os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
                with open(LOG_PATH, "a") as f:
                    f.write(json.dumps(data) + "\n")
            self._send(200, {"ok": True, "logged": bool(new)})
        elif path == "/note":
            with _lock:
                _note.clear()
                _note.update({
                    "text": str(data.get("text", ""))[:2000],
                    "pick": data.get("pick"),
                    "updated": time.time(),
                })
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *a):
        pass  # the draft is noisy enough


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"draft relay listening on http://127.0.0.1:{PORT}")
    print(f"  state log -> {LOG_PATH}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
