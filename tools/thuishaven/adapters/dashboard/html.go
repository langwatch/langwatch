package dashboard

import (
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// renderHTML draws the theme-aware dashboard: one card per stack showing which
// worktree owns which slug, its branch, redis DB, and every service hostname.
func renderHTML(stacks []domain.Stack, sharedURL func(string) string) string {
	var cards strings.Builder
	if len(stacks) == 0 {
		cards.WriteString(`<p class="empty">No stacks running. Start one with <code>pnpm dev</code> in a worktree.</p>`)
	}
	for _, s := range stacks {
		dot := "stale"
		if s.LauncherPID != 0 {
			dot = "live"
		}
		var rows strings.Builder
		for _, svc := range s.Services {
			rows.WriteString(fmt.Sprintf(
				`<tr><td class="svc">%s</td><td><a href="%s">%s</a></td><td class="dim">127.0.0.1:%d</td></tr>`,
				svc.Name, svc.URL, svc.Hostname, svc.Port))
			// The API shares app's origin — show it as a sub-row so the single URL
			// is unmistakable (no separate api.<slug> hostname).
			if svc.Name == "app" && s.APIPort != 0 {
				rows.WriteString(fmt.Sprintf(
					`<tr><td class="svc dim">└ api</td><td><a href="%s/api">%s/api</a></td><td class="dim">127.0.0.1:%d</td></tr>`,
					svc.URL, svc.Hostname, s.APIPort))
			}
		}
		cards.WriteString(fmt.Sprintf(`
      <section class="card">
        <header><span class="slug">%s</span><span class="pill %s">%s</span></header>
        <div class="meta"><span>branch <code>%s</code></span><span>redis db <code>%d</code></span></div>
        <div class="dir">%s</div>
        <table>%s</table>
      </section>`, s.Slug, dot, dot, s.Branch, s.RedisDB, s.WorktreeDir, rows.String()))
	}
	return fmt.Sprintf(pageTemplate,
		cards.String(),
		sharedURL("observability"), hostFromURL(sharedURL("observability")),
		sharedURL("telemetry"), hostFromURL(sharedURL("telemetry")))
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
<title>thuishaven — LangWatch local stacks</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --dim:#666; --card:#f6f7f9; --line:#e3e5e9; --accent:#7c3aed; --live:#16a34a; --stale:#b45309; }
  @media (prefers-color-scheme: dark){ :root{ --bg:#0e0f13; --fg:#e9eaee; --dim:#9aa0ab; --card:#171922; --line:#262a35; --accent:#a78bfa; } }
  * { box-sizing:border-box; } body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--fg); }
  header.top { padding:20px 28px; border-bottom:1px solid var(--line); display:flex; align-items:baseline; gap:12px; }
  header.top h1 { margin:0; font-size:18px; letter-spacing:.02em; } header.top .tag { color:var(--dim); font-size:13px; }
  main { padding:24px 28px; display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .card header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
  .slug { font-weight:650; font-size:15px; } .pill { font-size:11px; padding:2px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:.05em; }
  .pill.live { background:color-mix(in oklab,var(--live) 22%%,transparent); color:var(--live); }
  .pill.stale { background:color-mix(in oklab,var(--stale) 22%%,transparent); color:var(--stale); }
  .meta { display:flex; gap:16px; color:var(--dim); font-size:12.5px; margin-bottom:4px; }
  .dir { color:var(--dim); font-size:12px; word-break:break-all; margin-bottom:10px; }
  table { width:100%%; border-collapse:collapse; } td { padding:3px 0; } .svc { width:70px; color:var(--dim); }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  .dim { color:var(--dim); font-size:12px; } code { background:color-mix(in oklab,var(--fg) 10%%,transparent); padding:1px 5px; border-radius:5px; font-size:12px; }
  .empty { grid-column:1/-1; color:var(--dim); }
  .shared { padding:12px 28px 28px; color:var(--dim); font-size:12.5px; } .shared a { color:var(--accent); }
</style></head><body>
<header class="top"><h1>thuishaven</h1><span class="tag">LangWatch local stacks — hostname routing via portless</span></header>
<main>%s</main>
<div class="shared">shared &middot; observability <a href="%s">%s</a> &middot; telemetry fan-out <a href="%s">%s</a></div>
</body></html>`
