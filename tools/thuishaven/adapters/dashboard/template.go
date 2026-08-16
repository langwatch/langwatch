package dashboard

// The page follows the LangWatch design language: warm paper and a warm ink
// scale (never blue-gray), one orange brand accent, semantic moss/amber/rust
// used only as meaning, serif for the one statement, sans for interface, mono
// for machine output, pill-shaped interactive chrome, hairline borders only on
// true surfaces, whitespace instead of dividers, and a still page: nothing
// animates except the live dots and the refresh heartbeat. Light is the
// canonical scheme; dark inverts the same tokens. Copy avoids em-dashes by
// house rule.
const pageTemplate = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>haven, this machine's stacks</title>
<style>
  :root { color-scheme: light dark;
    --paper:#ffffff; --paper-soft:#efeee9; --paper-deep:#e3e2dc;
    --ink-900:#141417; --ink-600:#36352f; --ink-500:#4d4d46; --ink-400:#6d6c64;
    --ink-300:#99988f; --ink-100:#e3e2dd; --ink-50:#f0f0ee;
    --brand:#f56b1a; --brand-deep:#d65209; --brand-soft:rgba(245,107,26,.09);
    --moss:#5b7a4a; --amber:#c97b3a; --rust:#b85240;
    --moss-soft:rgba(91,122,74,.13); --amber-soft:rgba(201,123,58,.14); --rust-soft:rgba(184,82,64,.12);
    --shadow:0 30px 80px -30px rgba(30,20,40,.18), 0 10px 30px -15px rgba(30,20,40,.08);
    --grain-opacity:.022; }
  @media (prefers-color-scheme: dark){ :root{
    --paper:#0a0a0c; --paper-soft:#17171a; --paper-deep:#1f1f23;
    --ink-900:#f0f0ee; --ink-600:#c6c4bf; --ink-500:#99988f; --ink-400:#8a887f;
    --ink-300:#6d6c64; --ink-100:#26261f; --ink-50:#1b1b15;
    --brand:#ff8a3d; --brand-deep:#ffb380; --brand-soft:rgba(255,138,61,.12);
    --moss:#8fb87a; --amber:#d99a5e; --rust:#cf8a7a;
    --moss-soft:rgba(143,184,122,.14); --amber-soft:rgba(217,154,94,.15); --rust-soft:rgba(207,138,122,.14);
    --shadow:0 30px 80px -30px rgba(0,0,0,.5), 0 10px 30px -15px rgba(0,0,0,.3);
    --grain-opacity:.03; } }
  * { box-sizing:border-box; }
  html { background:var(--paper); }
  body { margin:0; font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Geist",sans-serif;
    background:var(--paper); color:var(--ink-600); min-height:100vh;
    -webkit-font-smoothing:antialiased; }
  /* paper grain: exists to kill sterile flatness, never consciously noticeable */
  body::before { content:""; position:fixed; inset:0; z-index:9; pointer-events:none;
    opacity:var(--grain-opacity); mix-blend-mode:multiply;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E"); }
  @media (prefers-color-scheme: dark){ body::before { mix-blend-mode:screen; } }

  .shell { max-width:1120px; margin:0 auto; padding:0 24px; }

  header.top { display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:26px 0 0; }
  .wordmark { font-weight:650; font-size:16px; color:var(--ink-900); letter-spacing:-.01em; }
  .wordmark .mark { color:var(--brand); margin-right:6px; }
  header.top .links { margin-left:auto; display:flex; gap:8px; align-items:center; }
  header.top .links a { color:var(--ink-500); font-size:13px; font-weight:500; text-decoration:none;
    border:1px solid var(--ink-100); border-radius:999px; padding:5px 14px;
    transition:color .3s, border-color .3s; }
  header.top .links a:hover { color:var(--ink-900); border-color:var(--ink-300); }
  .pressure { font-size:11.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
    color:var(--rust); background:var(--rust-soft); border-radius:999px; padding:4px 12px; }

  .statement { margin:44px 0 0; font-family:"Sentient",ui-serif,Georgia,serif; font-weight:400;
    font-size:clamp(28px,4vw,40px); line-height:1.05; letter-spacing:-.02em; color:var(--ink-900);
    transform:scale(1,1.06); transform-origin:left top; }

  .stats { display:flex; gap:44px; flex-wrap:wrap; margin:38px 0 0; }
  .stat .n { display:block; font-size:26px; font-weight:650; color:var(--ink-900);
    font-variant-numeric:tabular-nums; letter-spacing:-.01em; }
  .stat .of { color:var(--ink-300); font-weight:450; font-size:.68em; }
  .stat .l { display:block; margin-top:2px; color:var(--ink-400); font-size:11px; font-weight:550;
    text-transform:uppercase; letter-spacing:.14em; }

  .machine { margin:26px 0 0; max-width:720px; }
  .bar { display:flex; height:8px; border-radius:999px; overflow:hidden; background:var(--paper-deep); }
  .bar .dev { background:var(--brand); }
  .bar .other { background:var(--ink-300); }
  .legend { margin-top:10px; font-size:12.5px; color:var(--ink-400); display:flex; gap:18px; flex-wrap:wrap; }
  .legend .key { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:7px; vertical-align:0; }
  .legend .key.dev { background:var(--brand); }
  .legend .key.other { background:var(--ink-300); }
  .legend .breakdown { color:var(--ink-300); }

  .kicker { margin:56px 0 16px; font-size:11.5px; font-weight:600; letter-spacing:.18em;
    text-transform:uppercase; color:var(--ink-400); }
  .kicker .count { color:var(--ink-300); font-weight:500; letter-spacing:.06em; margin-left:8px; }

  main.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:18px; }
  .card { background:var(--paper); border:1px solid var(--ink-100); border-radius:14px;
    padding:18px 20px 14px; box-shadow:var(--shadow); }
  @media (prefers-color-scheme: dark){ .card { background:var(--paper-soft); } }
  .card header { display:flex; align-items:center; gap:10px; }
  .card header .spacer { flex:1; }
  .slug { font-weight:650; font-size:15.5px; color:var(--ink-900); letter-spacing:-.01em; }
  .pill { font-size:11px; font-weight:600; padding:3px 10px; border-radius:999px;
    text-transform:uppercase; letter-spacing:.08em; }
  .pill.live { background:var(--moss-soft); color:var(--moss); }
  .pill.stale { background:var(--amber-soft); color:var(--amber); }
  .open { font-size:12.5px; font-weight:550; color:var(--brand-deep); text-decoration:none;
    background:var(--brand-soft); border-radius:999px; padding:3px 12px; transition:filter .3s; }
  .open:hover { filter:brightness(.92); }
  .branch { margin-top:3px; color:var(--ink-400); font-size:12.5px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; margin:12px 0 4px; }
  .chip { font-size:11.5px; color:var(--ink-500); background:var(--paper-soft);
    border-radius:999px; padding:3px 10px; }
  @media (prefers-color-scheme: dark){ .chip { background:var(--paper-deep); } }
  .chip code { font-family:ui-monospace,"SF Mono","JetBrains Mono",monospace; font-size:11px; color:var(--ink-600); }
  .chip.baseline { color:var(--brand-deep); background:var(--brand-soft); font-weight:600; }
  .dir { color:var(--ink-300); font-size:11px; font-family:ui-monospace,"SF Mono",monospace;
    word-break:break-all; margin:6px 0 10px; }
  table.svcs { width:100%; border-collapse:collapse; table-layout:fixed; }
  table.svcs td { padding:6px 0; border-top:1px solid var(--ink-50); vertical-align:middle;
    overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  table.svcs tr:first-child td { border-top:0; }
  .dot-cell { width:20px; }
  .dot { display:inline-block; width:7px; height:7px; border-radius:50%; position:relative; }
  .dot.up { background:var(--moss); }
  .dot.up::after { content:""; position:absolute; inset:-3px; border-radius:50%;
    border:1.5px solid var(--moss); opacity:.4; animation:ping 2.6s ease-out infinite; }
  @keyframes ping { 0%{ transform:scale(.6); opacity:.5; } 80%,100%{ transform:scale(1.5); opacity:0; } }
  @media (prefers-reduced-motion: reduce){ .dot.up::after { animation:none; } }
  .dot.down { background:var(--rust); opacity:.7; }
  .subglyph { color:var(--ink-300); font-family:ui-monospace,"SF Mono",monospace; font-size:12px; }
  table.svcs a { color:var(--ink-600); font-size:12.5px; text-decoration:none;
    font-family:ui-monospace,"SF Mono","JetBrains Mono",monospace; transition:color .3s; }
  table.svcs a:hover { color:var(--brand-deep); }
  .port { width:58px; color:var(--ink-300); font-size:12px; font-family:ui-monospace,"SF Mono",monospace; text-align:right; }

  .empty { grid-column:1/-1; color:var(--ink-400); padding:40px 0 8px; }
  .empty h2 { margin:0 0 6px; font-family:"Sentient",ui-serif,Georgia,serif; font-weight:400;
    font-size:22px; color:var(--ink-900); }
  .empty code { background:var(--paper-soft); padding:4px 12px; border-radius:8px;
    font-family:ui-monospace,"SF Mono",monospace; font-size:13px; color:var(--ink-600); }

  .strip { margin:18px 0 0; font-size:12.5px; color:var(--ink-400); }
  .strip code { font-family:ui-monospace,"SF Mono",monospace; font-size:12px; color:var(--ink-500); }

  .wt-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:2px 32px; }
  .wt { display:flex; align-items:baseline; gap:10px; padding:7px 0; border-top:1px solid var(--ink-50);
    min-width:0; }
  .wt b { color:var(--ink-900); font-weight:550; font-size:13.5px; white-space:nowrap; }
  .wt .b { color:var(--ink-400); font-size:12.5px; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; min-width:0; }
  .wt .note { margin-left:auto; font-size:10.5px; font-weight:600; letter-spacing:.06em;
    text-transform:uppercase; color:var(--ink-300); white-space:nowrap; }

  table.reap { border-collapse:collapse; max-width:860px; width:100%; }
  table.reap td { padding:7px 18px 7px 0; border-top:1px solid var(--ink-50); vertical-align:baseline; }
  table.reap tr:first-child td { border-top:0; }
  .age { color:var(--ink-300); font-size:12px; font-family:ui-monospace,"SF Mono",monospace; white-space:nowrap; }
  .kind { color:var(--brand-deep); font-size:12px; font-weight:600; letter-spacing:.04em; }
  .target { color:var(--ink-600); font-size:13px; font-family:ui-monospace,"SF Mono",monospace; }
  .why { color:var(--ink-400); font-size:12.5px; }

  footer { margin:64px 0 40px; display:flex; gap:9px; align-items:center;
    color:var(--ink-300); font-size:12px; }
  #beat { width:6px; height:6px; border-radius:50%; background:var(--moss); }
  #beat.off { background:var(--amber); }
</style></head><body>
<div class="shell">
<header class="top">
  <span class="wordmark"><span class="mark">●</span>haven</span>
  {{if .Pressure}}<span class="pressure">pressure {{.Pressure}}</span>{{end}}
  <span class="links">
    <a href="{{.ObsURL}}">observability</a>
    <a href="{{.TelURL}}">telemetry</a>
  </span>
</header>
<div id="live">
<h1 class="statement">What this machine is running</h1>
<div class="stats">{{range .Stats}}
  <div class="stat"><span class="n">{{.Value}}{{if .Of}}<span class="of"> / {{.Of}}</span>{{end}}</span><span class="l">{{.Label}}</span></div>{{end}}
</div>
{{with .Bar}}<div class="machine">
  <div class="bar"><div class="dev" style="width:{{.DevPct}}%"></div><div class="other" style="width:{{.OtherPct}}%"></div></div>
  <div class="legend"><span><span class="key dev"></span>{{.DevLabel}}</span><span><span class="key other"></span>{{.OtherLabel}}</span><span class="breakdown">{{.Breakdown}}</span></div>
</div>{{end}}

<div class="kicker">Stacks</div>
<main class="cards">{{if .IsEmpty}}<div class="empty"><h2>Nothing running yet</h2>
    <p>Bring a stack up from any worktree and it appears here, on its own hostname.</p>
    <code>haven up</code></div>{{end}}{{range .Cards}}
  <section class="card">
    <header><span class="slug">{{.Slug}}</span><span class="spacer"></span>{{if .OpenURL}}<a class="open" href="{{.OpenURL}}">open</a>{{end}}<span class="pill {{.BadgeClass}}">{{.Badge}}</span></header>
    <div class="branch">{{.Branch}}</div>
    <div class="chips">{{range .Chips}}{{if .IsBaseline}}<span class="chip baseline">baseline</span>{{else}}<span class="chip">{{.Label}} <code>{{.Value}}</code></span>{{end}}{{end}}</div>
    <div class="dir" title="{{.DirFull}}">{{.Dir}}</div>
    <table class="svcs">{{range .Rows}}<tr><td class="dot-cell">{{if not .IsSub}}<span class="dot {{.DotClass}}"></span>{{end}}</td><td class="host">{{if .IsSub}}<span class="subglyph">└</span> {{end}}<a href="{{.URL}}" title="{{.URL}}">{{.Host}}</a></td><td class="port">{{.Port}}</td></tr>{{end}}</table>
  </section>{{end}}</main>
{{if .SharedNote}}<div class="strip">{{.SharedNote}}</div>{{end}}

{{if .Worktrees}}<div class="kicker">Worktrees<span class="count">nothing running from these</span></div>
<div class="wt-grid">{{range .Worktrees}}
  <div class="wt" title="{{.Dir}}"><b>{{.Name}}</b><span class="b">{{.Branch}}</span>{{if .Note}}<span class="note">{{.Note}}</span>{{end}}</div>{{end}}
</div>{{end}}

{{if .Events}}<div class="kicker">Recent reaping<span class="count">what the daemon reclaimed</span></div>
<table class="reap">{{range .Events}}
  <tr><td class="age">{{.Age}}</td><td class="kind">{{.Kind}}</td><td class="target">{{.Target}}</td><td class="why">{{.Reason}}</td></tr>{{end}}
</table>{{end}}
</div>
<footer><span id="beat"></span><span id="stamp">live, refreshes every 3s</span></footer>
</div>
<script>
(() => {
  let failures = 0;
  const beat = document.getElementById('beat'), stamp = document.getElementById('stamp');
  async function refresh() {
    const live = document.getElementById('live');
    // Skip the swap while the user is tabbing through it: replacing the
    // subtree would destroy the focused link every three seconds.
    if (document.hidden || live.contains(document.activeElement)) return;
    try {
      const res = await fetch('/', {cache: 'no-store'});
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const next = doc.getElementById('live');
      if (next) live.replaceChildren(...next.children);
      failures = 0;
      beat.classList.remove('off');
      stamp.textContent = 'live, updated ' + new Date().toLocaleTimeString();
    } catch {
      if (++failures >= 2) { beat.classList.add('off'); stamp.textContent = 'daemon unreachable, retrying'; }
    }
  }
  setInterval(refresh, 3000);
  document.addEventListener('visibilitychange', refresh);
})();
</script>
</body></html>`
