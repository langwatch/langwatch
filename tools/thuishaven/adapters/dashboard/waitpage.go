package dashboard

import (
	"html/template"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// WaitHeader marks haven's wait answer, so the page's poll tells it from the service's own.
const WaitHeader = "X-Haven-Waiting"

// waitFor is the stack service a wait answer is about.
type waitFor struct{ service, slug string }

// waitTarget is the service and slug a stack service's Host header names
// (<service>.<slug>.langwatch.localhost); ok is false for the hub, a stack
// home, a shared surface and anything off the project domain.
func (s *Server) waitTarget(host string) (waitFor, bool) {
	if h, _, found := strings.Cut(host, ":"); found {
		host = h
	}
	n := s.config.Naming
	if n.Project == "" {
		return waitFor{}, false
	}
	label, isUnder := strings.CutSuffix(strings.ToLower(host), "."+n.Project+"."+n.TLD)
	if !isUnder {
		return waitFor{}, false
	}
	service, slug, ok := strings.Cut(label, ".")
	if !ok || service == "" || !domain.ValidSlug(slug) {
		return waitFor{}, false
	}
	return waitFor{service: service, slug: slug}, true
}

// serveWaiting answers every request on a stack service's host with the wait
// answer: the daemon only receives one while that service's route points here.
func (s *Server) serveWaiting(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target, ok := s.waitTarget(r.Host)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		s.handleWait(w, r, target)
	})
}

type waitView struct {
	Service, Slug, State, Reason, HubURL, LogsURL string
}

func (s *Server) handleWait(w http.ResponseWriter, r *http.Request, target waitFor) {
	state, reason := s.waitState(target)
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Retry-After", "1")
	h.Set(WaitHeader, state)
	if r.Method != http.MethodGet || !strings.Contains(r.Header.Get("Accept"), "text/html") {
		http.Error(w, "haven: "+target.service+" of stack "+target.slug+" is "+state, http.StatusServiceUnavailable)
		return
	}
	hub := strings.TrimRight(s.hubURL(), "/")
	h.Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = waitPage.Execute(w, waitView{
		Service: target.service, Slug: target.slug, State: state, Reason: reason,
		HubURL: hub, LogsURL: hub + "/logs/" + url.PathEscape(target.slug),
	})
}

// aliasOwner is the service a host alias (ds) stands for, or the name itself.
func aliasOwner(name string) string {
	for owner, aliases := range domain.ServiceHostAliases {
		if slices.Contains(aliases, name) {
			return owner
		}
	}
	return name
}

// waitState is the service's state as the stack home reads it: starting while
// its launcher lives and its port does not answer, stopped once the launcher is
// gone. reason is the stack home's own line for it, never a log line.
func (s *Server) waitState(target waitFor) (state, reason string) {
	stacks := s.config.Stacks()
	i := slices.IndexFunc(stacks, func(st domain.Stack) bool { return st.Slug == target.slug })
	if i < 0 || !s.isLive(stacks[i]) {
		return "stopped", ""
	}
	h := homeState{stack: stacks[i], registered: true, live: true}
	surfaces := s.surfaces(h)
	explain(h, surfaces, nil)
	name := aliasOwner(target.service)
	if j := slices.IndexFunc(surfaces, func(sf surfaceJSON) bool { return sf.Name == name }); j >= 0 {
		return surfaces[j].Status, surfaces[j].Reason
	}
	return statusStarting, ""
}

// waitPage polls its own address with HEAD, 1s backing off to 5s, and reloads
// it (path and query kept) once the answer is the service's, not haven's.
var waitPage = template.Must(template.New("wait").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Service}} · {{.Slug}} is {{.State}} · haven</title>
<style>
:root{color-scheme:light dark;--paper:light-dark(#fff,#0a0a0c);--paper-soft:light-dark(#f4f3ef,#141416);
--ink-900:light-dark(#141417,#f0f0ee);--ink-500:light-dark(#6d6c64,#8a887f);--line:light-dark(#e3e2dd,#26261f);
--brand:light-dark(#f56b1a,#ff8a3d);--amber:light-dark(#b06a2c,#d99a5e);
--font-serif:"Sentient",ui-serif,Georgia,serif;--font-sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif;
--font-mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink-900);font:14px/1.5 var(--font-sans)}
main{max-width:34rem;padding:2rem;border:1px solid var(--line);border-radius:12px;background:var(--paper-soft)}
h1{font:400 28px/1.2 var(--font-serif);margin:0 0 .5rem}
code{font-family:var(--font-mono)}.state{color:var(--amber)}.muted{color:var(--ink-500);font-size:12px}
a{color:var(--brand)}nav{display:flex;gap:1rem;margin-top:1rem}
</style></head><body><main>
<h1><code>{{.Service}}</code> is not answering yet</h1>
<p>Stack <code>{{.Slug}}</code>: <span class="state" id="state">{{.State}}</span></p>
{{if .Reason}}<p class="muted">{{.Reason}}</p>{{end}}
<p class="muted" id="poll">This page reloads by itself the moment it answers.</p>
<nav><a href="{{.HubURL}}">Hub</a><a href="{{.LogsURL}}">Logs</a></nav>
</main><script>
(function(){var delay=1000;function poll(){fetch(location.href,{method:"HEAD",cache:"no-store"}).then(function(r){
var waiting=r.headers.get("` + WaitHeader + `");if(!waiting&&r.status!==502){location.reload();return}
if(waiting)document.getElementById("state").textContent=waiting}).catch(function(){}).finally(function(){
delay=Math.min(5000,delay*1.5);setTimeout(poll,delay)})}setTimeout(poll,delay)})();
</script></body></html>
`))
