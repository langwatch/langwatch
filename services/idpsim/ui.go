package idpsim

import (
	"html/template"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

// verificationLabel is the label LangWatch publishes its proof under, so the
// registry answers the name the verifier actually asks for rather than one
// that merely looks right.
const verificationLabel = "_langwatch-verification"

/**
 * The record name and the bare domain, from whichever of the two was typed.
 *
 * LangWatch's panel shows the NAME — `_langwatch-verification.acme.test` —
 * and a person filling this in copies that row. A registrar's own console
 * usually wants the bare domain instead, which is what somebody who knows
 * DNS will reach for. Both are the same record, so both are accepted rather
 * than one of them being a mistake the form refuses to understand.
 */
func verificationTarget(typed string) (name, domain string) {
	normalized := normalizeDomain(typed)
	if normalized == "" {
		return "", ""
	}
	if after, found := strings.CutPrefix(normalized, verificationLabel+"."); found {
		return normalized, after
	}
	return verificationLabel + "." + normalized, normalized
}

// pageCSS is the whole stylesheet. idpsim serves its own pages from the
// binary, so there is nothing to fetch and nothing to build; it follows the
// viewer's light/dark preference because a dev tool that blinds you at night
// is a dev tool you stop opening.
const pageCSS = `
:root {
  --bg: #fbfbfa; --panel: #ffffff; --ink: #1c1c1a; --muted: #6b6b66;
  --line: #e3e3df; --accent: #2f5eea; --ok: #197a4b; --refused: #b3261e;
  --code-bg: #f2f2ef;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a; --panel: #1e1e23; --ink: #ececf0; --muted: #9a9aa4;
    --line: #2e2e36; --accent: #7d9bff; --ok: #59c68f; --refused: #ff8a80;
    --code-bg: #26262d;
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
h2 { font-size: 1.05rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
h3 { font-size: .8rem; margin: 1.25rem 0 .5rem; text-transform: uppercase;
     letter-spacing: .08em; color: var(--muted); font-weight: 600; }
p { margin: .35rem 0 .9rem; }
.lede { color: var(--muted); margin-bottom: 1.75rem; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: .7rem;
         padding: 1.1rem 1.35rem 1.35rem; margin: 0 0 1.1rem; }
.panel > p:first-of-type { margin-top: 0; }
.hint { color: var(--muted); font-size: .875rem; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
.field { display: grid; grid-template-columns: 10.5rem 1fr; gap: .5rem 1rem;
         align-items: baseline; padding: .45rem 0; border-top: 1px solid var(--line); }
.field:first-of-type { border-top: 0; }
.field dt { color: var(--muted); font-size: .875rem; }
.field dd { margin: 0; }
.copy { display: flex; gap: .5rem; align-items: center; }
.copy .val { background: var(--code-bg); border-radius: .35rem; padding: .2rem .45rem;
             font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem;
             overflow-wrap: anywhere; }
button, .btn {
  font: inherit; font-size: .82rem; padding: .3rem .7rem; border-radius: .4rem;
  border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer;
}
button:hover, .btn:hover { border-color: var(--accent); color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-size: .9rem;
                 padding: .5rem 1.1rem; }
button.primary:hover { filter: brightness(1.08); color: #fff; }
form label { display: block; margin: .9rem 0 0; font-size: .875rem; color: var(--muted); }
/* Every text field on these pages is a plain <input name=…>: the forms are
   pasted into rather than typed, and none of them wanted a type attribute.
   Selecting on [type=text] therefore styled none of them. */
input:not([type]), input[type=text], textarea {
  width: 100%; margin-top: .3rem; padding: .5rem .6rem; border-radius: .4rem;
  border: 1px solid var(--line); background: var(--bg); color: var(--ink);
  font: inherit; font-size: .9rem;
}
textarea { min-height: 4.5rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
/* A client id or secret is one long unbreakable token. Left to wrap inside a
   narrow table cell it breaks after every character and the row grows to a
   screenful, so in a table it stays on one line and truncates — the copy
   button is how the value is meant to be taken anyway, and the full string is
   on the element's title. */
td .copy .val {
  display: inline-block; max-width: 17ch; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; vertical-align: bottom;
}
td .mono { overflow-wrap: anywhere; }
td .copy { flex-wrap: nowrap; }
th, td { text-align: left; padding: .4rem .6rem .4rem 0; border-top: 1px solid var(--line);
         font-size: .875rem; vertical-align: baseline; }
th { color: var(--muted); font-weight: 600; font-size: .8rem; border-top: 0; }
.pill { display: inline-block; font-size: .72rem; padding: .08rem .45rem; border-radius: 1rem;
        border: 1px solid currentColor; }
.ok { color: var(--ok); } .refused { color: var(--refused); }
.empty { color: var(--muted); font-style: italic; }
.tenants { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: .75rem; }
.tenants a { display: block; padding: .8rem 1rem; border: 1px solid var(--line); border-radius: .6rem;
             background: var(--panel); text-decoration: none; color: inherit; }
.tenants a:hover { border-color: var(--accent); }
.tenants strong { display: block; }
.row { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin: 1.1rem 0 .3rem; }
.row form { margin: 0; }
.crumb { font-size: .85rem; color: var(--muted); margin-bottom: 1rem; }
.new { border-color: var(--accent); }
.new h2 { color: var(--accent); }
`

// layoutTemplate wraps every page. Templates that use it define "title" and
// "content".
const layoutTemplate = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{template "title" .}}</title>
<style>` + pageCSS + `</style>
</head><body><main>
{{template "content" .}}
</main>
<script>
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-copy]');
  if (!btn) return;
  navigator.clipboard.writeText(btn.getAttribute('data-copy')).then(function () {
    var was = btn.textContent; btn.textContent = 'copied';
    setTimeout(function () { btn.textContent = was; }, 1200);
  });
});
var feed = document.getElementById('activity');
if (feed) {
  var poll = function () {
    fetch(feed.getAttribute('data-src')).then(function (r) { return r.json(); }).then(function (data) {
      var rows = (data.events || []).map(function (ev) {
        var at = new Date(ev.at).toLocaleTimeString();
        var cls = ev.outcome === 'ok' ? 'ok' : 'refused';
        var who = ev.subject || ev.client || '';
        return '<tr><td class="mono">' + at + '</td>' +
               '<td><span class="pill ' + cls + '">' + ev.outcome + '</span></td>' +
               '<td class="mono">' + ev.kind + '</td>' +
               '<td>' + escapeHTML(ev.detail) + (who ? ' <span class="hint">· ' + escapeHTML(who) + '</span>' : '') + '</td></tr>';
      }).join('');
      feed.innerHTML = rows || '<tr><td colspan="4" class="empty">Nothing yet. Send a login through this tenant and it shows up here.</td></tr>';
    }).catch(function () {});
  };
  var escapeHTML = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  poll(); setInterval(poll, 2000);
}
</script>
</body></html>`

var (
	indexPage  = template.Must(template.New("layout").Parse(layoutTemplate + indexContent))
	tenantPage = template.Must(template.New("layout").Parse(layoutTemplate + tenantContent))
	refusal    = template.Must(template.New("layout").Parse(layoutTemplate + refusalContent))
)

const indexContent = `
{{define "title"}}idpsim — simulated identity providers{{end}}
{{define "content"}}
<h1>idpsim</h1>
<p class="lede">{{len .Tenants}} simulated identity providers, each with its own users, keys and
domain. Pick one to register an application against it and watch what happens.{{if .DNSAddr}}
Verification DNS answers on <code>{{.DNSAddr}}</code> over UDP.{{end}}</p>
<div class="tenants">
{{range .Tenants}}<a href="{{.BaseURL}}/"><strong>Tenant {{.ID}}</strong>
<span class="hint">{{.Domain}} · {{len .Users}} users · {{len .Apps}} registered</span></a>{{end}}
</div>
<h3>Control API</h3>
<p class="hint mono">GET /control/state · POST /control/t/{n}/reset · POST /control/t/{n}/users ·
POST /control/t/{n}/apps · POST /control/t/{n}/config · PUT /control/t/{n}/scim-target ·
POST /control/t/{n}/scim-push · POST /control/t/{n}/scim-pull ·
GET /control/t/{n}/activity · PUT /control/dns/txt · PUT /control/verification</p>
{{end}}`

const tenantContent = `
{{define "title"}}idpsim tenant {{.Tenant.ID}}{{end}}
{{define "content"}}
<p class="crumb"><a href="{{.Root}}/">idpsim</a> / tenant {{.Tenant.ID}}</p>
<h1>Tenant {{.Tenant.ID}}</h1>
<p class="lede">A simulated identity provider that owns <code>{{.Tenant.Domain}}</code>.
It speaks OIDC and SAML, provisions over SCIM, and can prove it owns its domain over DNS or HTTP.</p>

{{with .Registered}}
<section class="panel new">
<h2>{{.Name}} is registered</h2>
<p>Paste these into LangWatch's <em>Then tell us about it</em> step. They do not change.</p>
<dl>
  <div class="field"><dt>Name</dt><dd>{{.Name}}</dd></div>
  <div class="field"><dt>Issuer address</dt><dd><span class="copy"><span class="val">{{$.Tenant.BaseURL}}</span><button data-copy="{{$.Tenant.BaseURL}}">copy</button></span></dd></div>
  <div class="field"><dt>Client id</dt><dd><span class="copy"><span class="val">{{.ClientID}}</span><button data-copy="{{.ClientID}}">copy</button></span></dd></div>
  <div class="field"><dt>Client secret</dt><dd><span class="copy"><span class="val">{{.Secret}}</span><button data-copy="{{.Secret}}">copy</button></span></dd></div>
</dl>
</section>
{{end}}

<section class="panel">
<h2>Register an application</h2>
<p>Give this tenant the redirect address LangWatch showed you, and it hands back the
issuer, client id and client secret to paste back into the wizard.</p>
<p class="hint">The address LangWatch shows before a connection exists ends in
<code>{{"{connection}"}}</code>. Paste it exactly as written — a <code>{{"{placeholder}"}}</code>
segment here matches whatever real id turns up, so you do not have to come back once you know it.</p>
<form method="post" action="{{.Tenant.BaseURL}}/apps">
  <label>Name<input type="text" name="name" placeholder="LangWatch" required></label>
  <label>Redirect address <span class="hint">— one per line</span>
    <textarea name="redirect_uris" placeholder="https://app.example.langwatch.localhost/api/auth/sso/callback/{connection}"></textarea></label>
  <label>Service provider entity id <span class="hint">— optional, for SAML</span>
    <input type="text" name="entity_id" placeholder="https://app.example.langwatch.localhost/api/auth/sso/saml2/sp"></label>
  <label>Assertion consumer address <span class="hint">— optional, for SAML</span>
    <input type="text" name="acs_url" placeholder="https://app.example.langwatch.localhost/api/auth/sso/saml2/sp/acs/{connection}"></label>
  <p style="margin-top:1.1rem"><button class="primary" type="submit">Register</button></p>
</form>
</section>

<section class="panel">
<h2>Registered applications</h2>
{{if .Tenant.Apps}}
<div class="scroll">
<table>
<tr><th>Name</th><th>Client id</th><th>Client secret</th><th>Redirect addresses</th><th></th></tr>
{{range .Tenant.Apps}}
<tr>
  <td>{{.Name}}</td>
  <td><span class="copy"><span class="val" title="{{.ClientID}}">{{.ClientID}}</span><button data-copy="{{.ClientID}}">copy</button></span></td>
  <td><span class="copy"><span class="val" title="{{.Secret}}">{{.Secret}}</span><button data-copy="{{.Secret}}">copy</button></span></td>
  <td>{{range .RedirectURIs}}<div class="mono">{{.}}</div>{{end}}
      {{if .ACSURL}}<div class="mono hint">SAML → {{.ACSURL}}</div>{{end}}</td>
  <td><form method="post" action="{{$.Tenant.BaseURL}}/apps/{{.ClientID}}/delete"><button type="submit">remove</button></form></td>
</tr>
{{end}}
</table>
</div>
<p class="hint">A registered client must present its secret and one of its redirect addresses.
A client id this tenant does not know is still accepted with anything — that is the
zero-setup path, and the feed below says which of the two happened.</p>
{{else}}
<p class="empty">None yet — this tenant accepts any client id, secret and redirect address.</p>
{{end}}
</section>

<section class="panel">
<h2>If you connect over OpenID Connect</h2>
<dl>
  <div class="field"><dt>Issuer address</dt><dd><span class="copy"><span class="val">{{.Tenant.BaseURL}}</span><button data-copy="{{.Tenant.BaseURL}}">copy</button></span></dd></div>
  <div class="field"><dt>Client id</dt><dd>{{if .Tenant.Apps}}from a registered application above{{else}}<span class="hint">register an application above, or send any client id you like</span>{{end}}</dd></div>
</dl>
<p class="hint">LangWatch checks the issuer by fetching
<a href="{{.Tenant.BaseURL}}/.well-known/openid-configuration">its discovery document</a> when you
save, so the address has to be reachable from wherever the app is running.</p>
</section>

<section class="panel">
<h2>If you connect over SAML</h2>
<dl>
  <div class="field"><dt>Sign-in address</dt><dd><span class="copy"><span class="val">{{.Tenant.SAMLSignInURL}}</span><button data-copy="{{.Tenant.SAMLSignInURL}}">copy</button></span></dd></div>
  <div class="field"><dt>Entity id</dt><dd><span class="copy"><span class="val">{{.Tenant.SAMLEntityID}}</span><button data-copy="{{.Tenant.SAMLEntityID}}">copy</button></span></dd></div>
  <div class="field"><dt>Signing certificate</dt><dd><span class="copy"><button data-copy="{{.Tenant.Certificate}}">copy the certificate</button></span></dd></div>
  <div class="field"><dt>Metadata</dt><dd><a href="{{.Tenant.BaseURL}}/saml/metadata">the metadata document</a> <span class="hint">— paste its contents if you would rather give metadata than an entity id and certificate</span></dd></div>
</dl>
</section>

<section class="panel">
<h2>Directory and domain</h2>
<dl>
  <div class="field"><dt>SCIM base</dt><dd><span class="copy"><span class="val">{{.Tenant.BaseURL}}/scim/v2</span><button data-copy="{{.Tenant.BaseURL}}/scim/v2">copy</button></span></dd></div>
  <div class="field"><dt>SCIM token <span class="hint">— into this tenant</span></dt><dd><span class="copy"><span class="val">{{.Tenant.SCIMToken}}</span><button data-copy="{{.Tenant.SCIMToken}}">copy</button></span></dd></div>
  <div class="field"><dt>Domain proof</dt><dd>a TXT record on <code>{{.Tenant.Domain}}</code>{{if .DNSAddr}}, answered on <code>{{.DNSAddr}}</code>{{end}}, or the same token under <code>/.well-known/</code> over HTTP</dd></div>
</dl>
<p class="hint">That token guards this tenant's own directory, for provisioning
<em>into</em> the simulator. Sending users the other way — the direction a real identity
provider runs — uses LangWatch's token, below.</p>
</section>

{{/* Provisioning out. The whole panel exists because the credential is the
     receiving side's: LangWatch mints it, or takes one the administrator
     already had, and the identity provider presents it. A simulator that
     generated its own would be handing out a key to a door it does not own,
     which is why this is a box rather than a value to copy. */}}
<section class="panel{{if .Outcome}} new{{end}}">
<h2>Provision into LangWatch</h2>
<p>Give this tenant LangWatch's SCIM address and the token LangWatch issued, and it
provisions its users and groups the way Okta or Entra would.</p>
<details>
  <summary class="hint">Why you paste a token here instead of copying one</summary>
  <p class="hint">SCIM runs one way: the identity provider sends its directory to the
  application, so the application is the side that issues the credential. LangWatch mints
  the token — or takes one you already had — and whoever provisions presents it. A token
  invented here would open nothing.</p>
  <p class="hint">This is also the one thing on the page with two of everything, so: the
  token under <em>Directory and domain</em> is the way in, and this one is the way out.
  Pasting that one here is refused rather than left to fail as an unauthorized push.</p>
</details>
{{if .Provisioning.Configured}}
<dl>
  <div class="field"><dt>Provisioning into</dt><dd><span class="copy"><span class="val">{{.Provisioning.BaseURL}}</span><button data-copy="{{.Provisioning.BaseURL}}">copy</button></span></dd></div>
  <div class="field"><dt>With the token</dt><dd class="mono">{{.Provisioning.Token}} <span class="hint">— enough to tell it is the one you pasted</span></dd></div>
</dl>
<div class="row">
  <form method="post" action="{{.Tenant.BaseURL}}/provisioning/push"><button class="primary" type="submit">Push the directory</button></form>
  <form method="post" action="{{.Tenant.BaseURL}}/provisioning/pull"><button type="submit">Read it back</button></form>
  <form method="post" action="{{.Tenant.BaseURL}}/provisioning/delete"><button type="submit">Forget</button></form>
</div>
<p class="hint">Pushing sends every user then every group as a SCIM create. Reading back asks
LangWatch what it holds now, which is the half that tells you what it made of them.</p>
{{else}}
<form method="post" action="{{.Tenant.BaseURL}}/provisioning">
  <label>SCIM address
    <input name="target" placeholder="https://app.your-worktree.langwatch.localhost/api/scim/v2" required>
  </label>
  <label>Token
    <input name="token" placeholder="the token LangWatch issued" required autocomplete="off">
  </label>
  <p class="hint" style="margin-top:.6rem">Both are on LangWatch's SCIM setup screen. A trailing
  <code>/Users</code> is trimmed, so the endpoint you were last looking at works too.</p>
  <p style="margin-top:1.1rem"><button class="primary" type="submit">Connect</button></p>
</form>
{{end}}
{{with .Outcome}}
<p class="hint" style="margin-top:1.2rem">Last {{if eq .Kind "push"}}push{{else}}read-back{{end}}:
<span class="pill {{if .Refused}}refused{{else}}ok{{end}}">{{if .Refused}}refused{{else}}ok{{end}}</span>
{{.Summary}}.</p>
{{if or .Users .Groups}}
<table>
<tr><th>Users LangWatch holds</th><th>Groups</th></tr>
<tr><td>{{range .Users}}<div class="mono">{{.}}</div>{{else}}<span class="empty">none</span>{{end}}</td>
    <td>{{range .Groups}}<div class="mono">{{.}}</div>{{else}}<span class="empty">none</span>{{end}}</td></tr>
</table>
{{end}}
{{if .Failures}}
<p class="hint">Refused by LangWatch:</p>
{{range .Failures}}<div class="mono hint">{{.}}</div>{{end}}
{{end}}
{{end}}
</section>

<section class="panel">
<h2>DNS registry</h2>
<p class="hint">Paste the value LangWatch showed you and it is published where the
check will look{{if .DNSAddr}} — this machine answers DNS on <code>{{.DNSAddr}}</code>{{end}}.</p>
<details>
  <summary class="hint">Why this exists, and what publishing actually does</summary>
  <p class="hint">Proving a domain is the one step that happens somewhere else: you leave
  LangWatch, sign in to whoever administers the domain, add a record, and come back.
  A reserved name like <code>acme.test</code> has no registrar and nothing on the
  internet answers for it, so this stands in — publishing here is the same act as
  adding the record in Cloudflare or Route 53.</p>
  <p class="hint">One press publishes both channels: the TXT record at
  <code>_langwatch-verification.&lt;domain&gt;</code> <em>and</em> the same value as the
  well-known file, so whichever one the check asks for, it finds it. The value is
  LangWatch's — it mints it and shows it once — so this takes it rather than inventing
  one, which would prove the domain against a token the product never issued.</p>
</details>
{{/* The fields are LangWatch's own, in LangWatch's order and under
     LangWatch's words, because this form is filled in by copying that panel
     row by row. Asking for a "domain" when the panel opposite says "name"
     made the reader translate between two vocabularies for one string, and
     the translation they reached for was pasting the name into the value. */}}
<form method="post" action="{{.Tenant.BaseURL}}/dns">
  <label>Name
    <input name="domain" placeholder="_langwatch-verification.{{.Tenant.Domain}}" required>
  </label>
  <label>Value
    <input name="value" placeholder="the value LangWatch showed you once" required autocomplete="off">
  </label>
  <p class="hint" style="margin-top:.6rem">Copy the two rows LangWatch shows under
  <em>Publish this on {{.Tenant.Domain}}</em>. The type is always TXT, so there is no
  field for it — and a bare domain works too, we add the label.</p>
  <p style="margin-top:1.1rem"><button class="primary" type="submit">Publish the record</button></p>
</form>
{{if .Records}}
<table>
<tr><th>TXT record</th><th>Value</th><th>Answers</th><th></th></tr>
{{range .Records}}
<tr>
  <td class="mono">{{.Name}}</td>
  <td><span class="copy"><span class="val" title="{{.Value}}">{{.Value}}</span><button data-copy="{{.Value}}">copy</button></span></td>
  <td>{{if .Verifies}}<span class="pill ok">a LangWatch check</span>{{else}}<span class="hint">nothing yet — seeded at the bare domain</span>{{end}}</td>
  <td><form method="post" action="{{$.Tenant.BaseURL}}/dns/delete" style="margin:0">
    <input type="hidden" name="name" value="{{.Name}}">
    <button type="submit">remove</button>
  </form></td>
</tr>
{{end}}
</table>
<p class="hint">Removing a record is how you watch a proof lapse: the checker stops
finding it, exactly as it would if somebody deleted it at the registrar.</p>
{{else}}
<p class="hint">Nothing is published for <code>{{.Tenant.Domain}}</code> yet.</p>
{{end}}
</section>

<section class="panel">
<h2>Users</h2>
<table>
<tr><th>Email</th><th>Name</th><th>Groups</th><th>Status</th></tr>
{{range .Tenant.Users}}
<tr><td class="mono">{{.Email}}</td><td>{{.DisplayName}}</td>
    <td class="hint">{{range .Groups}}{{.}} {{end}}</td>
    <td>{{if .Active}}<span class="pill ok">active</span>{{else}}<span class="pill refused">inactive</span>{{end}}</td></tr>
{{end}}
</table>
<p class="hint">A login started from your application lands on the account picker, where you
choose one of these. There are no passwords — picking a user is the whole ceremony.</p>
<p class="hint">Scripts and tests can skip the picker: add <code>login_hint=&lt;email&gt;</code>
to the authorization request and this tenant redirects straight back with a code for that
user, with nothing to click.</p>
</section>

<section class="panel">
<h2>Activity</h2>
<p class="hint">Live. Every request this tenant serves or refuses, newest first.</p>
<table><tbody id="activity" data-src="{{.Root}}/control/t/{{.Tenant.ID}}/activity">
<tr><td colspan="4" class="empty">Loading…</td></tr>
</tbody></table>
</section>
{{end}}`

const refusalContent = `
{{define "title"}}idpsim — refused{{end}}
{{define "content"}}
<p class="crumb"><a href="{{.Root}}/">idpsim</a> / tenant {{.TenantID}}</p>
<h1>{{.Title}}</h1>
<section class="panel">
<p>{{.Detail}}</p>
<p class="hint">{{.Hint}}</p>
<p><a class="btn" href="{{.TenantURL}}/">Open tenant {{.TenantID}}</a></p>
</section>
{{end}}`

// tenantView is one tenant as the pages render it. The SAML fields are the
// values LangWatch's wizard asks to have pasted in — a sign-in address plus
// either metadata or an entity id and a certificate — so they are rendered
// ready to copy rather than left for someone to extract from the metadata XML
// by hand.
type tenantView struct {
	ID            int
	Domain        string
	BaseURL       string
	SCIMToken     string
	SAMLEntityID  string
	SAMLSignInURL string
	Certificate   string
	Users         []*User
	Apps          []*Application
}

func viewOf(t *Tenant) tenantView {
	return tenantView{
		ID: t.ID, Domain: t.Domain, BaseURL: t.BaseURL, SCIMToken: t.SCIMToken,
		// crewjam/saml publishes the metadata address as the entity id, so
		// this is the value that appears in the metadata document too.
		SAMLEntityID:  t.BaseURL + "/saml/metadata",
		SAMLSignInURL: t.BaseURL + "/saml/sso",
		Certificate:   t.CertificatePEM(),
		Users:         t.Users(), Apps: t.Applications(),
	}
}

// provisioningView is the tenant's connection as the page shows it: the
// address in full, and only enough of the token to recognize it. The value is
// LangWatch's rather than ours, and the reason to show any of it is answering
// "is that the one I pasted?".
type provisioningView struct {
	Configured bool
	BaseURL    string
	Token      string
}

func provisioningViewOf(t *Tenant) provisioningView {
	target := t.Provisioning()
	return provisioningView{
		Configured: target.Configured(),
		BaseURL:    target.BaseURL,
		Token:      maskedToken(target.Token),
	}
}

// handleIndex lists the tenants.
func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	views := make([]tenantView, 0, len(s.tenants))
	for _, t := range s.tenants {
		views = append(views, viewOf(t))
	}
	s.renderPage(w, indexPage, map[string]any{
		"Tenants": views, "DNSAddr": s.DNSAddr(),
	})
}

/**
 * The DNS registry: this machine standing in for a domain's registrar.
 *
 * WHY IT IS A PAGE AND NOT ONLY AN API. A domain proof is the one step of
 * single sign-on setup that happens somewhere else — you leave the product,
 * sign in to whoever administers the domain, add a record, and come back.
 * Locally there is no "somewhere else": `acme.test` is reserved, no resolver
 * on earth answers for it, and the only thing that can is this simulator. A
 * control endpoint made that possible and left it a curl command; a form
 * makes the local walk the same shape as the real one, which is the whole
 * point of a simulator.
 *
 * The value comes from LangWatch, which mints it and shows it once, so this
 * takes it rather than generating one — generating our own would prove a
 * domain against a token the product never issued, which is a green tick
 * that means nothing.
 */

// publishedRecord is one TXT answer this machine is serving.
type publishedRecord struct {
	Name  string
	Value string
	// Verifies is true when this record sits at the name a LangWatch check
	// actually asks for. The seeded records do NOT: they sit at the bare
	// domain, which no verifier queries, and a table that drew the two the
	// same way told a reader their domain was already published when the
	// check would find nothing.
	Verifies bool
}

/**
 * What the registry is answering FOR THIS TENANT.
 *
 * Scoped to the tenant's own domain because the store is machine-wide: three
 * tenants' seeded records on one tenant's page are three rows of somebody
 * else's business, and the reader has to work out which one is theirs before
 * they can read the one that is.
 *
 * Name-ordered, so the table does not reshuffle between two loads.
 */
func (s *Server) publishedRecords(domain string) []publishedRecord {
	txt, _ := s.verification.Snapshot()
	zone := normalizeDomain(domain)
	records := make([]publishedRecord, 0, len(txt))
	for name, values := range txt {
		if name != zone && !strings.HasSuffix(name, "."+zone) {
			continue
		}
		records = append(records, publishedRecord{
			Name:     name,
			Value:    strings.Join(values, " "),
			Verifies: strings.HasPrefix(name, verificationLabel+"."),
		})
	}
	sort.Slice(records, func(i, j int) bool { return records[i].Name < records[j].Name })
	return records
}

/**
 * Publish a verification value, on both channels at once.
 *
 * TWO CHANNELS, ONE PRESS, because the product offers both and a person
 * pasting a value has no idea which one the check will use — and finding out
 * by failing the check is a bad way to learn it. The TXT record goes at the
 * name the verifier actually asks for; the same value is served as the
 * well-known file for the bare domain.
 */
func (s *Server) handlePublishVerification(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "unparseable form", http.StatusBadRequest)
		return
	}
	name, domain := verificationTarget(r.PostForm.Get("domain"))
	value := strings.TrimSpace(r.PostForm.Get("value"))
	if name == "" || value == "" {
		s.refusalPage(w, t, refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "A record needs a name and a value",
			Detail: "Publishing puts one value where a verifier will look for it, so it needs to know both.",
			Hint:   "Both are on the LangWatch screen that asked you to prove the domain — the value is shown once, when it is issued.",
		})
		return
	}
	// The name and the value are different strings, and the one thing a
	// reader can do by accident is paste the name into both — so say so,
	// rather than publishing a record that proves itself.
	if normalizeDomain(value) == name {
		s.refusalPage(w, t, refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "That is the record's name, not its value",
			Detail: "The name says where the record goes; the value is the secret LangWatch minted to put there.",
			Hint:   "On the LangWatch screen the value is the row under the name, shown once when the record is issued.",
		})
		return
	}

	s.verification.SetTXT(name, []string{value})
	s.verification.SetToken(domain, value)
	s.record(t, Event{
		Kind:    "verification.publish",
		Outcome: OutcomeOK,
		Detail:  "published the verification value at " + name + " and under /.well-known/",
	})
	http.Redirect(w, r, t.BaseURL+"/?published="+url.QueryEscape(name), http.StatusSeeOther)
}

// handleUnpublishVerification takes a record back out, which is how a lapsed
// proof is watched: the checker simply stops finding it.
func (s *Server) handleUnpublishVerification(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "unparseable form", http.StatusBadRequest)
		return
	}
	name := normalizeDomain(r.PostForm.Get("name"))
	if name == "" {
		http.Redirect(w, r, t.BaseURL+"/", http.StatusSeeOther)
		return
	}
	s.verification.RemoveTXT(name)
	// The well-known token is keyed by the bare domain, so removing the record
	// removes its other half too — leaving one behind would let a proof the
	// page reports as gone keep succeeding down the other channel.
	s.verification.RemoveToken(strings.TrimPrefix(name, verificationLabel+"."))
	s.record(t, Event{
		Kind:    "verification.unpublish",
		Outcome: OutcomeOK,
		Detail:  "took the verification value at " + name + " back out",
	})
	http.Redirect(w, r, t.BaseURL+"/", http.StatusSeeOther)
}

// handleTenantPage is one tenant's own page: how to wire an application up,
// what is registered, who its users are, and what it has been doing.
func (s *Server) handleTenantPage(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	data := map[string]any{
		"Tenant": viewOf(t),
		"Root":   s.cfg.BaseURL, "DNSAddr": s.DNSAddr(),
		"Records":      s.publishedRecords(t.Domain),
		"Provisioning": provisioningViewOf(t),
		"Outcome":      t.LastProvisioning(),
	}
	// ?registered=<client id> is where the registration POST lands, so the
	// credentials are shown once, at the top, right after they are minted.
	if id := r.URL.Query().Get("registered"); id != "" {
		if app, ok := t.ApplicationByClientID(id); ok {
			data["Registered"] = app
		}
	}
	s.renderPage(w, tenantPage, data)
}

// handleRegisterApplication takes the registration form and redirects back to
// the tenant page with the new credentials on show.
func (s *Server) handleRegisterApplication(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "unparseable form", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(r.PostForm.Get("name"))
	if name == "" {
		s.refusalPage(w, t, refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "That application needs a name",
			Detail: "Every registration is listed by name, so it needs one.",
			Hint:   "Give it whatever the application calls itself — LangWatch, say.",
		})
		return
	}
	app := t.RegisterApplication(Registration{
		Name:         name,
		RedirectURIs: splitLines(r.PostForm.Get("redirect_uris")),
		EntityID:     strings.TrimSpace(r.PostForm.Get("entity_id")),
		ACSURL:       strings.TrimSpace(r.PostForm.Get("acs_url")),
	}, s.now())
	s.record(t, Event{
		Kind:    "app.register",
		Outcome: OutcomeOK,
		Client:  app.ClientID,
		Detail:  "registered the application " + app.Name,
	})
	http.Redirect(w, r, t.BaseURL+"/?registered="+app.ClientID, http.StatusSeeOther)
}

// handleRemoveApplication un-registers an application.
func (s *Server) handleRemoveApplication(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	clientID := r.PathValue("client")
	if t.RemoveApplication(clientID) {
		s.record(t, Event{
			Kind:    "app.remove",
			Outcome: OutcomeOK,
			Client:  clientID,
			Detail:  "un-registered an application",
		})
	}
	http.Redirect(w, r, t.BaseURL+"/", http.StatusSeeOther)
}

// refusalNotice is what a refusal page says: what happened, and what to go and
// change about it.
type refusalNotice struct {
	Status int
	Title  string
	Detail string
	Hint   string
}

// refusalPage explains a refusal in the browser, because the person reading it
// is mid-way through wiring two systems together and needs to know which one
// to go and fix.
func (s *Server) refusalPage(w http.ResponseWriter, t *Tenant, n refusalNotice) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(n.Status)
	_ = refusal.Execute(w, map[string]any{
		"Title": n.Title, "Detail": n.Detail, "Hint": n.Hint,
		"TenantID": t.ID, "TenantURL": t.BaseURL, "Root": s.cfg.BaseURL,
	})
}

func (s *Server) renderPage(w http.ResponseWriter, tmpl *template.Template, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = tmpl.Execute(w, data)
}
