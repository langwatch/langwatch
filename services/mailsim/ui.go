package mailsim

import (
	_ "embed"
	"html/template"
	"net/http"
	"net/url"
	"strings"
)

//go:embed ui.css
var pageCSS string

//go:embed ui.js
var pageJS string

var layoutTemplate = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{template "title" .}}</title>
<style>` + pageCSS + `</style>
<script type="module" src="/assets/ui.js" defer></script>
</head><body><main>
<header class="top"><a class="brand" href="/">● <span>MailSim</span></a><span class="badge">LOCAL MAIL</span><span class="scope-name">{{.Scope}}</span><span class="host" id="host"></span></header>
{{template "content" .}}
<p id="notice" role="status"></p>
<footer>Captured locally. Messages are never relayed to their recipients.</footer>
</main></body></html>`

var (
	indexPage   = template.Must(template.New("layout").Parse(layoutTemplate + indexContent))
	messagePage = template.Must(template.New("layout").Parse(layoutTemplate + messageContent))
)

const indexContent = `
{{define "title"}}MailSim · Inbox{{end}}
{{define "content"}}
<div class="heading"><div><p class="eyebrow">YOUR STACK'S OUTBOX</p><h1>Every email, right here.</h1><p class="lede">Inspect invites, sign-in links and notifications as your app sends them.</p></div><span class="live" id="live-status" role="status">Live inbox</span></div>
<section class="scope-panel panel" aria-label="Inbox scope">
<div><p class="eyebrow">INBOX FOR {{.Scope}}</p><h2>One stack. Every recipient.</h2><p>Mail sent to this stack's SMTP listener lands here, whatever the recipient address. Other stacks have separate inboxes, even when they use the same email address.</p><p class="secondary">{{if .Persistent}}Captured messages survive service restarts.{{else}}This inbox is in memory and clears when MailSim restarts.{{end}}</p></div>
<div><h2>Addresses you can use</h2><p>Any email address works for capture. No mailbox setup is needed.</p><div class="address-example"><code>alex+invite@example.test</code><button type="button" data-copy="alex+invite@example.test">Copy address</button></div><p class="secondary">Receiving mail here does not create an app account. Sign up or invite that address in your app first.</p><details><summary>Connection details</summary><dl><div class="field"><dt>SMTP listener</dt><dd class="mono">{{.SMTP}}</dd></div><div class="field"><dt>Inbox</dt><dd class="mono">{{.BaseURL}}</dd></div></dl></details></div>
</section>
<section class="panel recipients-panel" aria-label="Recipient addresses"><div class="section-heading"><h2>Recipients in this inbox <span class="secondary" id="recipient-count"></span></h2><button type="button" id="all-recipients">All recipients</button></div><p class="secondary">Addresses from retained messages. Select one to filter the inbox.</p><div id="recipients" class="recipients"><p class="secondary">No addresses yet. They appear when this stack sends mail.</p></div></section>
<div class="toolbar"><label class="search">Search inbox<input id="search" type="search" placeholder="Subject, recipient or sender" autocomplete="off"></label><span id="count">{{len .Messages}} messages</span><button id="refresh" type="button">Refresh</button><button id="notify" type="button" aria-pressed="false" title="Show a desktop notification when a message arrives, even when this tab is in the background">Notify me</button><button id="clear" class="danger" type="button">Clear inbox</button></div>
<section class="panel inbox" aria-label="Caught messages"><div class="scroll"><table>
<thead><tr><th>Message</th><th>Recipient</th><th>Received</th><th>Size</th></tr></thead>
<tbody id="messages">{{range .Messages}}
<tr data-message="{{.ID}}"><td><a class="subject" href="/messages/{{.ID}}">{{if .Subject}}{{.Subject}}{{else}}(no subject){{end}}</a><div class="secondary">{{.From}}</div></td><td class="mono">{{range .To}}<div>{{.}}</div>{{end}}</td><td class="mono">{{.ReceivedAt.Format "Jan 02, 15:04:05"}}</td><td class="secondary">{{.SizeBytes}} B</td></tr>
{{end}}</tbody></table></div>
<p class="empty" id="empty" {{if .Messages}}hidden{{end}}>No messages yet. Trigger an invite or sign-in email in your app and it will appear here.</p></section>
{{end}}`

const messageContent = `
{{define "title"}}MailSim · {{.Message.Subject}}{{end}}
{{define "content"}}
<p class="crumb"><a href="/">← Inbox</a></p>
<h1 class="message-title">{{if .Message.Subject}}{{.Message.Subject}}{{else}}(no subject){{end}}</h1>
<section class="panel"><dl>
<div class="field"><dt>From</dt><dd class="mono">{{.Message.From}}</dd></div>
<div class="field"><dt>To</dt><dd class="mono">{{range .Message.To}}{{.}} {{end}}</dd></div>
<div class="field"><dt>Received</dt><dd>{{.Message.ReceivedAt.Format "02 Jan 2006, 15:04:05 MST"}}</dd></div>
<div class="field"><dt>Size</dt><dd>{{.Message.SizeBytes}} bytes</dd></div>
</dl></section>
<div class="toolbar"><div class="tabs" role="tablist" aria-label="Message format">
{{if .Message.HTML}}<button type="button" id="tab-preview" role="tab" data-view="preview" aria-controls="preview" aria-selected="true">Preview</button>{{end}}
<button type="button" id="tab-text" role="tab" data-view="text" aria-controls="text" aria-selected="{{if .Message.HTML}}false{{else}}true{{end}}">Plain text</button>
<button type="button" id="tab-headers" role="tab" data-view="headers" aria-controls="headers" aria-selected="false">Headers</button></div>
<a class="btn" href="/api/messages/{{.Message.ID}}">View JSON</a><button type="button" data-delete="{{.Message.ID}}" class="danger">Delete message</button></div>
{{if .Message.HTML}}<section id="preview" role="tabpanel" aria-labelledby="tab-preview"><iframe class="body" title="Email preview" sandbox="allow-popups allow-popups-to-escape-sandbox" src="/api/messages/{{.Message.ID}}/html"></iframe></section>{{end}}
<section class="panel" id="text" role="tabpanel" aria-labelledby="tab-text" {{if .Message.HTML}}hidden{{end}}><pre>{{if .Message.Text}}{{.Message.LinkifiedText}}{{else}}This message has no plain-text body.{{end}}</pre></section>
<section class="panel" id="headers" role="tabpanel" aria-labelledby="tab-headers" hidden><dl>{{range $key, $value := .Message.Headers}}<div class="field"><dt class="mono">{{$key}}</dt><dd class="mono">{{$value}}</dd></div>{{end}}</dl></section>
{{if .Message.Links}}<section class="panel"><h2>Links in this email</h2><ul class="links">{{range .Message.Links}}<li><a href="{{.}}" target="_blank" rel="noreferrer">{{.}}</a><button type="button" data-copy="{{.}}">Copy</button></li>{{end}}</ul></section>{{end}}
{{if .Message.Attachments}}<section class="panel"><h2>Attachments</h2>{{range .Message.Attachments}}<p>{{.Filename}} <span class="secondary">{{.ContentType}} · {{.SizeBytes}} bytes</span></p>{{end}}<p class="secondary">Attachment metadata only.</p></section>{{end}}
{{end}}`

func serveUIScript(w http.ResponseWriter, _ *http.Request) {
	setBaseHeaders(w)
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write([]byte(pageJS))
}

// handleUIIndex lists caught messages newest first.
func (s *Server) handleUIIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	setUIHeaders(w)
	renderPage(w, indexPage, s.pageData("Messages", s.store.List("", "")))
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
	renderPage(w, messagePage, s.pageData("Message", msg))
}

func renderPage(w http.ResponseWriter, tmpl *template.Template, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = tmpl.Execute(w, data)
}

func (s *Server) pageData(key string, value any) map[string]any {
	scope := "Standalone MailSim"
	if origin, err := url.Parse(s.cfg.BaseURL); err == nil && strings.HasPrefix(origin.Hostname(), "mail.") && strings.HasSuffix(origin.Hostname(), ".langwatch.localhost") {
		scope = strings.TrimSuffix(strings.TrimPrefix(origin.Hostname(), "mail."), ".langwatch.localhost")
	}
	smtp := s.cfg.SMTPAddr
	if strings.HasPrefix(smtp, ":") {
		smtp = "127.0.0.1" + smtp
	}
	return map[string]any{key: value, "Scope": scope, "SMTP": smtp, "BaseURL": s.cfg.BaseURL, "Persistent": s.cfg.DataDir != ""}
}
