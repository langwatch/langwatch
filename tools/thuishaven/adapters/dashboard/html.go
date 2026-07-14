package dashboard

import (
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// renderHTML draws the hub: aggregate health up top (stacks, services, RAM,
// databases), then one card per stack — which worktree owns which slug, its
// branch, databases, footprint, and every service hostname with a live dot.
func renderHTML(stacks []domain.Stack, sharedURL func(string) string, probes Probes) string {
	type agg struct {
		live, servicesUp, servicesTotal int
		rss                             uint64
	}
	var a agg

	var cards strings.Builder
	if len(stacks) == 0 {
		cards.WriteString(`<p class="empty">No stacks running — start one with <code>pnpm dev</code> in a worktree.</p>`)
	}
	for _, s := range stacks {
		live := s.LauncherPID != 0
		if live && probes.ProcessAlive != nil {
			live = probes.ProcessAlive(s.LauncherPID)
		}
		badge, badgeClass := "stale", "stale"
		if live {
			badge, badgeClass = "live", "live"
			a.live++
		}

		var rss uint64
		if live && probes.GroupRSS != nil {
			rss = probes.GroupRSS(s.LauncherPID)
			a.rss += rss
		}

		var rows strings.Builder
		for _, svc := range s.Services {
			a.servicesTotal++
			dotClass := "down"
			if probes.PortInUse != nil && probes.PortInUse(svc.Port) {
				dotClass = "up"
				a.servicesUp++
			}
			rows.WriteString(fmt.Sprintf(
				`<tr><td class="dot-cell"><span class="dot %s"></span></td><td class="svc">%s</td><td><a href="%s">%s</a></td><td class="dim mono">:%d</td></tr>`,
				dotClass, html.EscapeString(svc.Name), html.EscapeString(svc.URL), html.EscapeString(svc.Hostname), svc.Port))
			// The API shares app's origin — show it as a sub-row so the single URL
			// is unmistakable (no separate api.<slug> hostname).
			if svc.Name == "app" && s.APIPort != 0 {
				rows.WriteString(fmt.Sprintf(
					`<tr><td class="dot-cell"></td><td class="svc dim">└ api</td><td><a href="%s/api">%s/api</a></td><td class="dim mono">:%d</td></tr>`,
					html.EscapeString(svc.URL), html.EscapeString(svc.Hostname), s.APIPort))
			}
		}

		var chips strings.Builder
		chips.WriteString(chip("branch", s.Branch))
		if s.ClickHouseDatabase != "" {
			chips.WriteString(chip("clickhouse", s.ClickHouseDatabase))
		}
		chips.WriteString(chip("redis db", fmt.Sprintf("%d", s.RedisDB)))
		if rss > 0 {
			chips.WriteString(chip("ram", humanBytesU(rss)))
		}
		if !s.UpdatedAt.IsZero() {
			chips.WriteString(chip("heartbeat", shortAge(time.Since(s.UpdatedAt))))
		}
		if s.IsBaseline {
			chips.WriteString(`<span class="chip baseline">baseline</span>`)
		}

		cards.WriteString(fmt.Sprintf(`
      <section class="card">
        <header><span class="slug">%s</span><span class="pill %s">%s</span></header>
        <div class="chips">%s</div>
        <div class="dir">%s</div>
        <table>%s</table>
      </section>`, html.EscapeString(s.Slug), badgeClass, badge, chips.String(), html.EscapeString(s.WorktreeDir), rows.String()))
	}

	ramStat := "—"
	if a.rss > 0 {
		ramStat = humanBytesU(a.rss)
		if probes.TotalMemory != nil {
			if total := probes.TotalMemory(); total > 0 {
				ramStat += fmt.Sprintf(`<span class="of"> / %s</span>`, humanBytesU(total))
			}
		}
	}
	stats := fmt.Sprintf(`
    <div class="stat"><span class="n">%d<span class="of"> / %d</span></span><span class="l">stacks live</span></div>
    <div class="stat"><span class="n">%d<span class="of"> / %d</span></span><span class="l">services up</span></div>
    <div class="stat"><span class="n">%s</span><span class="l">stack ram</span></div>
    <div class="stat"><span class="n">%d</span><span class="l">databases</span></div>`,
		a.live, len(stacks), a.servicesUp, a.servicesTotal, ramStat, len(stacks))

	return fmt.Sprintf(pageTemplate,
		stats,
		cards.String(),
		sharedURL("observability"), hostFromURL(sharedURL("observability")),
		sharedURL("telemetry"), hostFromURL(sharedURL("telemetry")))
}

func chip(label, value string) string {
	return fmt.Sprintf(`<span class="chip">%s <code>%s</code></span>`,
		html.EscapeString(label), html.EscapeString(value))
}

func shortAge(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds ago", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	default:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
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

const pageTemplate = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
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
  body::before, body::after { content:""; position:fixed; z-index:-1; border-radius:50%%;
    filter:blur(90px); opacity:.35; pointer-events:none; }
  body::before { width:52vw; height:52vw; background:radial-gradient(circle at center, var(--accent), transparent 65%%);
    top:-18vw; right:-12vw; animation:drift1 26s ease-in-out infinite alternate; }
  body::after { width:44vw; height:44vw; background:radial-gradient(circle at center, var(--violet), transparent 65%%);
    bottom:-16vw; left:-10vw; opacity:.22; animation:drift2 32s ease-in-out infinite alternate; }
  @keyframes drift1 { from{ transform:translate(0,0) scale(1);} to{ transform:translate(-6vw,5vh) scale(1.12);} }
  @keyframes drift2 { from{ transform:translate(0,0) scale(1);} to{ transform:translate(5vw,-4vh) scale(1.08);} }
  @media (prefers-reduced-motion: reduce){ body::before, body::after{ animation:none; } .dot.up::after{ animation:none; } }

  header.top { padding:22px 30px 8px; display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
  header.top h1 { margin:0; font-size:19px; letter-spacing:.01em; font-weight:700; }
  header.top h1 .mark { color:var(--accent); }
  header.top .tag { color:var(--dim); font-size:13px; }

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
  .card:hover { transform:translateY(-2px); box-shadow:0 12px 32px -16px color-mix(in oklab, var(--accent) 42%%, transparent);
    border-color:color-mix(in oklab, var(--accent) 36%%, var(--line)); }
  .card header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
  .slug { font-weight:700; font-size:15.5px; }
  .pill { font-size:11px; padding:2px 9px; border-radius:999px; text-transform:uppercase; letter-spacing:.06em; font-weight:600; }
  .pill.live { background:color-mix(in oklab,var(--live) 18%%,transparent); color:var(--live); }
  .pill.stale { background:color-mix(in oklab,var(--stale) 18%%,transparent); color:var(--stale); }

  .chips { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
  .chip { color:var(--dim); font-size:11.5px; background:color-mix(in oklab, var(--fg) 4%%, transparent);
    border:1px solid var(--line); border-radius:999px; padding:2px 9px; }
  .chip code { background:none; padding:0; color:var(--fg); font-size:11.5px; }
  .chip.baseline { color:var(--accent); border-color:color-mix(in oklab, var(--accent) 42%%, var(--line));
    background:var(--accent-soft); font-weight:600; }
  .dir { color:var(--dim); font-size:11.5px; word-break:break-all; margin-bottom:10px; }

  table { width:100%%; border-collapse:collapse; } td { padding:3.5px 0; }
  .dot-cell { width:16px; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%%; position:relative; }
  .dot.up { background:var(--live); }
  .dot.up::after { content:""; position:absolute; inset:-3px; border-radius:50%%;
    border:1.5px solid var(--live); opacity:.5; animation:ping 2.2s ease-out infinite; }
  @keyframes ping { 0%%{ transform:scale(.6); opacity:.6; } 80%%,100%%{ transform:scale(1.5); opacity:0; } }
  .dot.down { background:var(--down); opacity:.75; }
  .svc { width:78px; color:var(--dim); }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  .dim { color:var(--dim); font-size:12px; } .mono { font-variant-numeric:tabular-nums; }
  code { background:color-mix(in oklab,var(--fg) 8%%,transparent); padding:1px 5px; border-radius:5px; font-size:12px; }
  .empty { grid-column:1/-1; color:var(--dim); }
  .shared { padding:14px 30px 30px; color:var(--dim); font-size:12.5px; } .shared a { color:var(--accent); }
</style></head><body>
<header class="top"><h1><span class="mark">●</span> haven</h1><span class="tag">LangWatch local stacks — hostname routing via portless</span></header>
<div class="stats">%s</div>
<main>%s</main>
<div class="shared">shared &middot; observability <a href="%s">%s</a> &middot; telemetry fan-out <a href="%s">%s</a></div>
</body></html>`
