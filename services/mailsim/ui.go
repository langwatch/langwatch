package mailsim

import (
	"html/template"
	"net/http"
)

// pageCSS is the whole stylesheet — the inbox serves its own pages from the
// binary, so there is nothing to fetch and nothing to build.
const pageCSS = `
:root {
  --bg: #fbfbfa; --panel: #ffffff; --ink: #1c1c1a; --muted: #6b6b66; --line: #e3e3df;
  --accent: #2f5eea; --code-bg: #f2f2ef;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a; --panel: #1e1e23; --ink: #ececf0; --muted: #9a9aa4; --line: #2e2e36;
    --accent: #7d9bff; --code-bg: #26262d;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1.5rem 4rem; background: var(--bg); color: var(--ink);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 60rem; margin: 0 auto; }
a { color: var(--accent); }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
p.lede { color: var(--muted); margin-bottom: 1.75rem; }
.crumb { font-size: .85rem; color: var(--muted); margin-bottom: 1rem; }
.empty { color: var(--muted); font-style: italic; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: .5rem .6rem .5rem 0; border-top: 1px solid var(--line); font-size: .9rem; }
th { color: var(--muted); font-weight: 600; font-size: .8rem; border-top: 0; }
tr:hover td { background: var(--panel); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: .7rem; padding: 1.1rem 1.35rem; margin: 0 0 1.1rem; }
.field { display: grid; grid-template-columns: 7rem 1fr; gap: .5rem 1rem; padding: .3rem 0; }
.field dt { color: var(--muted); font-size: .85rem; }
.field dd { margin: 0; }
button, .btn {
  font: inherit; font-size: .82rem; padding: .35rem .8rem; border-radius: .4rem;
  border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer;
}
button:hover, .btn:hover { border-color: var(--accent); color: var(--accent); }
iframe.body { width: 100%; height: 32rem; border: 1px solid var(--line); border-radius: .5rem; background: #fff; }
`

const layoutTemplate = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{template "title" .}}</title>
<style>` + pageCSS + `</style>
</head><body><main>
{{template "content" .}}
</main></body></html>`

var (
	indexPage   = template.Must(template.New("layout").Parse(layoutTemplate + indexContent))
	messagePage = template.Must(template.New("layout").Parse(layoutTemplate + messageContent))
)

const indexContent = `
{{define "title"}}mailsim — caught mail{{end}}
{{define "content"}}
<h1>mailsim</h1>
<p class="lede">Every message this stack has sent lands here, and nothing it catches is
ever relayed anywhere.</p>
{{if .Messages}}
<table>
<tr><th>From</th><th>To</th><th>Subject</th><th>Received</th></tr>
{{range .Messages}}
<tr><td class="mono">{{.From}}</td><td class="mono">{{range .To}}{{.}} {{end}}</td>
<td><a href="/messages/{{.ID}}">{{if .Subject}}{{.Subject}}{{else}}<span class="empty">(no subject)</span>{{end}}</a></td>
<td class="mono">{{.ReceivedAt.Format "15:04:05"}}</td></tr>
{{end}}
</table>
{{else}}
<p class="empty">Nothing caught yet.</p>
{{end}}
<form method="post" action="/messages/clear" style="margin-top:1.5rem">
<button type="submit" onclick="event.preventDefault();fetch('/api/messages',{method:'DELETE'}).then(()=>location.reload())">clear inbox</button>
</form>
{{end}}`

const messageContent = `
{{define "title"}}mailsim — {{.Message.Subject}}{{end}}
{{define "content"}}
<p class="crumb"><a href="/">mailsim</a> / message</p>
<h1>{{if .Message.Subject}}{{.Message.Subject}}{{else}}<span class="empty">(no subject)</span>{{end}}</h1>
<section class="panel">
<dl>
  <div class="field"><dt>From</dt><dd class="mono">{{.Message.From}}</dd></div>
  <div class="field"><dt>To</dt><dd class="mono">{{range .Message.To}}{{.}} {{end}}</dd></div>
  <div class="field"><dt>Received</dt><dd class="mono">{{.Message.ReceivedAt}}</dd></div>
</dl>
</section>
{{if .Message.HTML}}
<iframe class="body" sandbox src="/api/messages/{{.Message.ID}}/html"></iframe>
{{else}}
<section class="panel"><pre class="mono">{{.Message.Text}}</pre></section>
{{end}}
{{end}}`

// handleUIIndex lists caught messages newest first.
func (s *Server) handleUIIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	setUIHeaders(w)
	renderPage(w, indexPage, map[string]any{"Messages": s.store.List("", "")})
}

// handleUIMessage shows one message's headers, text and — via a sandboxed
// frame onto the API's own HTML endpoint — its HTML body.
func (s *Server) handleUIMessage(w http.ResponseWriter, r *http.Request) {
	msg, ok := s.store.Get(r.PathValue("id"))
	if !ok {
		setUIHeaders(w)
		http.NotFound(w, r)
		return
	}
	setUIHeaders(w)
	renderPage(w, messagePage, map[string]any{"Message": msg})
}

func renderPage(w http.ResponseWriter, tmpl *template.Template, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = tmpl.Execute(w, data)
}
