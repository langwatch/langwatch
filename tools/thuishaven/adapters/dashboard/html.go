package dashboard

import (
	"fmt"
	"html/template"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// stackCard is renderCard's result: the card's view data plus the per-stack
// numbers renderHTML aggregates into the page-level stats.
type stackCard struct {
	view          cardView
	isLive        bool
	rss           uint64
	servicesUp    int
	servicesTotal int
}

// cardView is one stack card as the template sees it — slug, live/stale pill,
// chips, worktree dir, and a row per service with a liveness dot.
type cardView struct {
	Slug       string
	Badge      string
	BadgeClass string
	Branch     string
	Dir        string
	OpenURL    string // the card's primary action; empty hides it
	Chips      []chipView
	Rows       []rowView
}

type chipView struct {
	Label      string
	Value      string
	IsBaseline bool
}

// rowView is one service line. IsSub marks the api sub-row rendered under the
// app service (the API shares app's origin, so it has no hostname of its own).
type rowView struct {
	DotClass string
	Name     string
	URL      string
	Host     string
	Port     int
	IsSub    bool
}

type statView struct {
	Value template.HTML
	Label string
}

type pageView struct {
	ObsURL, ObsHost string
	TelURL, TelHost string
	Stats           []statView
	Cards           []cardView
	IsEmpty         bool
}

// renderCard builds one stack's view data and per-stack aggregates.
func renderCard(s domain.Stack, probes Probes) stackCard {
	var c stackCard
	c.isLive = s.LauncherPID != 0
	if c.isLive && probes.ProcessAlive != nil {
		c.isLive = probes.ProcessAlive(s.LauncherPID)
	}
	badge := "stale"
	if c.isLive {
		badge = "live"
	}

	if c.isLive && probes.GroupRSS != nil {
		c.rss = probes.GroupRSS(s.LauncherPID)
	}

	var rows []rowView
	for _, svc := range s.Services {
		c.servicesTotal++
		dotClass := "down"
		if probes.PortInUse != nil && probes.PortInUse(svc.Port) {
			dotClass = "up"
			c.servicesUp++
		}
		rows = append(rows, rowView{DotClass: dotClass, Name: svc.Name, URL: svc.URL, Host: svc.Hostname, Port: svc.Port})
		// The API shares app's origin — show it as a sub-row so the single URL
		// is unmistakable (no separate api.<slug> hostname).
		if svc.Name == "app" && s.APIPort != 0 {
			rows = append(rows, rowView{IsSub: true, Name: "└ api", URL: svc.URL + "/api", Host: svc.Hostname + "/api", Port: s.APIPort})
		}
	}

	var chips []chipView
	if s.ClickHouseDatabase != "" {
		chips = append(chips, chipView{Label: "clickhouse", Value: s.ClickHouseDatabase})
	}
	chips = append(chips, chipView{Label: "redis db", Value: fmt.Sprintf("%d", s.RedisDB)})
	if c.rss > 0 {
		chips = append(chips, chipView{Label: "ram", Value: humanBytesU(c.rss)})
	}
	if !s.UpdatedAt.IsZero() {
		chips = append(chips, chipView{Label: "heartbeat", Value: shortAge(time.Since(s.UpdatedAt))})
	}
	if s.IsBaseline {
		chips = append(chips, chipView{IsBaseline: true})
	}

	// The card's primary action: open the app. Present whenever the stack has a
	// routed app URL, regardless of health — a booting stack is still one click.
	var openURL string
	for _, svc := range s.Services {
		if svc.Name == "app" && svc.URL != "" {
			openURL = svc.URL
			break
		}
	}

	c.view = cardView{
		Slug:       s.Slug,
		Badge:      badge,
		BadgeClass: badge,
		Branch:     s.Branch,
		Dir:        s.WorktreeDir,
		OpenURL:    openURL,
		Chips:      chips,
		Rows:       rows,
	}
	return c
}

// renderHTML draws the hub: aggregate health up top (stacks, services, RAM,
// databases), then one card per stack — which worktree owns which slug, its
// branch, databases, footprint, and every service hostname with a live dot.
func renderHTML(stacks []domain.Stack, sharedURL func(string) string, probes Probes) string {
	type agg struct {
		live, servicesUp, servicesTotal, databases int
		rss                                        uint64
	}
	var a agg

	var cards []cardView
	for _, s := range stacks {
		c := renderCard(s, probes)
		cards = append(cards, c.view)
		if c.isLive {
			a.live++
		}
		a.rss += c.rss
		a.servicesUp += c.servicesUp
		a.servicesTotal += c.servicesTotal
		// Real database allocations: a ClickHouse database when the stack has
		// one, plus the Redis DB every stack gets.
		if s.ClickHouseDatabase != "" {
			a.databases++
		}
		a.databases++
	}

	ramStat := template.HTML("—")
	if a.rss > 0 {
		ram := template.HTML(template.HTMLEscapeString(humanBytesU(a.rss)))
		if probes.TotalMemory != nil {
			if total := probes.TotalMemory(); total > 0 {
				ram += template.HTML(`<span class="of"> / ` + template.HTMLEscapeString(humanBytesU(total)) + `</span>`)
			}
		}
		ramStat = ram
	}
	ofN := func(n, of int) template.HTML {
		return template.HTML(fmt.Sprintf(`%d<span class="of"> / %d</span>`, n, of))
	}

	page := pageView{
		ObsURL: sharedURL("observability"), ObsHost: hostFromURL(sharedURL("observability")),
		TelURL: sharedURL("telemetry"), TelHost: hostFromURL(sharedURL("telemetry")),
		Stats: []statView{
			{Value: ofN(a.live, len(stacks)), Label: "stacks live"},
			{Value: ofN(a.servicesUp, a.servicesTotal), Label: "services up"},
			{Value: ramStat, Label: "stack ram"},
			{Value: template.HTML(fmt.Sprintf("%d", a.databases)), Label: "databases"},
		},
		Cards:   cards,
		IsEmpty: len(stacks) == 0,
	}

	var b strings.Builder
	if err := pageTmpl.Execute(&b, page); err != nil {
		// The template is static and the data is plain values, so this cannot
		// fail at runtime — but a page saying so beats a blank one if it ever does.
		return "<!doctype html><title>haven</title><p>dashboard render error: " +
			template.HTMLEscapeString(err.Error())
	}
	return b.String()
}

func shortAge(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds ago", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}

func humanBytesU(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%dB", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func hostFromURL(u string) string {
	u = strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://")
	if i := strings.IndexByte(u, ':'); i >= 0 {
		return u[:i]
	}
	return u
}

var pageTmpl = template.Must(template.New("page").Parse(pageTemplate))

const pageTemplate = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>haven — LangWatch local stacks</title>
<style>
  :root { color-scheme: light dark;
    --bg:#faf9f7; --fg:#1a1815; --dim:#6f6a62; --card:rgba(255,255,255,.72); --line:#e7e2da;
    --accent:#ed8926; --accent-soft:rgba(237,137,38,.14); --violet:#7c3aed;
    --live:#16a34a; --stale:#b45309; --down:#dc2626; }
  @media (prefers-color-scheme: dark){ :root{
    --bg:#0d0d10; --fg:#ece9e4; --dim:#98928a; --card:rgba(23,23,28,.66); --line:#26252c;
    --accent:#f59e3f; --accent-soft:rgba(245,158,63,.16); --violet:#a78bfa; } }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;
    background:var(--bg); color:var(--fg); min-height:100vh; }
  /* fluid gradient field behind everything */
  body::before, body::after { content:""; position:fixed; z-index:-1; border-radius:50%;
    filter:blur(90px); opacity:.35; pointer-events:none; }
  body::before { width:52vw; height:52vw; background:radial-gradient(circle at center, var(--accent), transparent 65%);
    top:-18vw; right:-12vw; animation:drift1 26s ease-in-out infinite alternate; }
  body::after { width:44vw; height:44vw; background:radial-gradient(circle at center, var(--violet), transparent 65%);
    bottom:-16vw; left:-10vw; opacity:.22; animation:drift2 32s ease-in-out infinite alternate; }
  @keyframes drift1 { from{ transform:translate(0,0) scale(1);} to{ transform:translate(-6vw,5vh) scale(1.12);} }
  @keyframes drift2 { from{ transform:translate(0,0) scale(1);} to{ transform:translate(5vw,-4vh) scale(1.08);} }
  @media (prefers-reduced-motion: reduce){ body::before, body::after{ animation:none; } .dot.up::after{ animation:none; } }

  header.top { position:sticky; top:0; z-index:10; padding:14px 30px; display:flex; align-items:center;
    gap:14px; flex-wrap:wrap; background:color-mix(in oklab, var(--bg) 72%, transparent);
    backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border-bottom:1px solid var(--line); }
  header.top h1 { margin:0; font-size:19px; letter-spacing:.01em; font-weight:700; }
  header.top h1 .mark { color:var(--accent); }
  header.top .tag { color:var(--dim); font-size:13px; }
  header.top .links { margin-left:auto; display:flex; gap:14px; align-items:center; font-size:12.5px; color:var(--dim); }
  header.top .links a { color:var(--dim); border:1px solid var(--line); border-radius:999px; padding:3px 11px;
    transition:color .15s ease, border-color .15s ease; }
  header.top .links a:hover { color:var(--accent); border-color:color-mix(in oklab, var(--accent) 45%, var(--line)); text-decoration:none; }
  #beat { width:7px; height:7px; border-radius:50%; background:var(--live); display:inline-block; }
  #beat.off { background:var(--stale); }

  .stats { display:flex; gap:12px; flex-wrap:wrap; padding:10px 30px 4px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:14px;
    padding:12px 18px; min-width:132px; backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); }
  .stat .n { display:block; font-size:22px; font-weight:700; font-variant-numeric:tabular-nums; }
  .stat .l { color:var(--dim); font-size:11.5px; text-transform:uppercase; letter-spacing:.08em; }
  .of { color:var(--dim); font-weight:500; font-size:.72em; }

  main { padding:18px 30px 8px; display:grid; grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 18px;
    backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
    transition:transform .22s ease, box-shadow .22s ease, border-color .22s ease; }
  .card:hover { transform:translateY(-2px); box-shadow:0 12px 32px -16px color-mix(in oklab, var(--accent) 42%, transparent);
    border-color:color-mix(in oklab, var(--accent) 36%, var(--line)); }
  .card header { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
  .card header .spacer { flex:1; }
  .slug { font-weight:700; font-size:15.5px; }
  .branch { color:var(--dim); font-size:12px; margin-bottom:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .open { font-size:12px; font-weight:600; color:var(--accent); border:1px solid color-mix(in oklab, var(--accent) 38%, var(--line));
    background:var(--accent-soft); border-radius:999px; padding:2px 11px; transition:background .15s ease; }
  .open:hover { background:color-mix(in oklab, var(--accent) 26%, transparent); text-decoration:none; }
  .pill { font-size:11px; padding:2px 9px; border-radius:999px; text-transform:uppercase; letter-spacing:.06em; font-weight:600; }
  .pill.live { background:color-mix(in oklab,var(--live) 18%,transparent); color:var(--live); }
  .pill.stale { background:color-mix(in oklab,var(--stale) 18%,transparent); color:var(--stale); }

  .chips { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
  .chip { color:var(--dim); font-size:11.5px; background:color-mix(in oklab, var(--fg) 4%, transparent);
    border:1px solid var(--line); border-radius:999px; padding:2px 9px; }
  .chip code { background:none; padding:0; color:var(--fg); font-size:11.5px; }
  .chip.baseline { color:var(--accent); border-color:color-mix(in oklab, var(--accent) 42%, var(--line));
    background:var(--accent-soft); font-weight:600; }
  .dir { color:var(--dim); font-size:11.5px; word-break:break-all; margin-bottom:10px; }

  table { width:100%; border-collapse:collapse; } td { padding:3.5px 0; }
  .dot-cell { width:16px; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; position:relative; }
  .dot.up { background:var(--live); }
  .dot.up::after { content:""; position:absolute; inset:-3px; border-radius:50%;
    border:1.5px solid var(--live); opacity:.5; animation:ping 2.2s ease-out infinite; }
  @keyframes ping { 0%{ transform:scale(.6); opacity:.6; } 80%,100%{ transform:scale(1.5); opacity:0; } }
  .dot.down { background:var(--down); opacity:.75; }
  .svc { width:78px; color:var(--dim); }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  .dim { color:var(--dim); font-size:12px; } .mono { font-variant-numeric:tabular-nums; }
  code { background:color-mix(in oklab,var(--fg) 8%,transparent); padding:1px 5px; border-radius:5px; font-size:12px; }
  .empty { grid-column:1/-1; color:var(--dim); text-align:center; padding:56px 0 64px; }
  .empty .glyph { font-size:40px; color:var(--accent); opacity:.8; }
  .empty h2 { margin:10px 0 6px; color:var(--fg); font-size:17px; }
  .empty code { font-size:13px; padding:5px 12px; }
  footer { padding:16px 30px 30px; color:var(--dim); font-size:12px; display:flex; gap:8px; align-items:center; }
</style></head><body>
<header class="top">
  <h1><span class="mark">●</span> haven</h1><span class="tag">LangWatch local stacks — hostname routing via portless</span>
  <span class="links">
    <a href="{{.ObsURL}}">observability · {{.ObsHost}}</a>
    <a href="{{.TelURL}}">telemetry · {{.TelHost}}</a>
  </span>
</header>
<div id="live">
<div class="stats">{{range .Stats}}
    <div class="stat"><span class="n">{{.Value}}</span><span class="l">{{.Label}}</span></div>{{end}}</div>
<main>{{if .IsEmpty}}<div class="empty"><div class="glyph">⌂</div><h2>No stacks running</h2>
      <p>Bring one up from any worktree and it appears here, on its own hostname.</p>
      <code>haven up</code></div>{{end}}{{range .Cards}}
      <section class="card">
        <header><span class="slug">{{.Slug}}</span><span class="spacer"></span>{{if .OpenURL}}<a class="open" href="{{.OpenURL}}">open ↗</a>{{end}}<span class="pill {{.BadgeClass}}">{{.Badge}}</span></header>
        <div class="branch">⎇ {{.Branch}}</div>
        <div class="chips">{{range .Chips}}{{if .IsBaseline}}<span class="chip baseline">baseline</span>{{else}}<span class="chip">{{.Label}} <code>{{.Value}}</code></span>{{end}}{{end}}</div>
        <div class="dir">{{.Dir}}</div>
        <table>{{range .Rows}}{{if .IsSub}}<tr><td class="dot-cell"></td><td class="svc dim">{{.Name}}</td><td><a href="{{.URL}}">{{.Host}}</a></td><td class="dim mono">:{{.Port}}</td></tr>{{else}}<tr><td class="dot-cell"><span class="dot {{.DotClass}}"></span></td><td class="svc">{{.Name}}</td><td><a href="{{.URL}}">{{.Host}}</a></td><td class="dim mono">:{{.Port}}</td></tr>{{end}}{{end}}</table>
      </section>{{end}}</main>
</div>
<footer><span id="beat"></span><span id="stamp">live — refreshes every 3s</span></footer>
<script>
(() => {
  let failures = 0;
  const beat = document.getElementById('beat'), stamp = document.getElementById('stamp');
  async function refresh() {
    const live = document.getElementById('live');
    // Skip the swap while the user is tabbing through it — replacing the
    // subtree would destroy the focused link every three seconds.
    if (document.hidden || live.contains(document.activeElement)) return;
    try {
      const res = await fetch('/', {cache: 'no-store'});
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const next = doc.getElementById('live');
      if (next) live.replaceChildren(...next.children);
      failures = 0;
      beat.classList.remove('off');
      stamp.textContent = 'live — updated ' + new Date().toLocaleTimeString();
    } catch {
      if (++failures >= 2) { beat.classList.add('off'); stamp.textContent = 'daemon unreachable — retrying'; }
    }
  }
  setInterval(refresh, 3000);
  document.addEventListener('visibilitychange', refresh);
})();
</script>
</body></html>`
