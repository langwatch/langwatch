/** Haven's wait page look (tools/thuishaven/adapters/dashboard/waitpage.go), self-contained. */
export const WAITING_FOR_API_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="2">
<title>api is not answering yet</title>
<style>
:root{color-scheme:light dark;--paper:#fff;--paper-soft:#f4f3ef;--ink:#141417;--muted:#6d6c64;--line:#e3e2dd;
--serif:ui-serif,Georgia,serif;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif;
--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media(prefers-color-scheme:dark){:root{--paper:#0a0a0c;--paper-soft:#141416;--ink:#f0f0ee;--muted:#8a887f;--line:#26261f}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:14px/1.5 var(--sans)}
main{max-width:34rem;padding:2rem;border:1px solid var(--line);border-radius:12px;background:var(--paper-soft)}
h1{font:400 28px/1.2 var(--serif);margin:0 0 .5rem}
code{font-family:var(--mono)}.muted{color:var(--muted);font-size:12px}
</style></head><body><main>
<h1><code>api</code> is not answering yet</h1>
<p class="muted">This page reloads by itself the moment it answers.</p>
</main></body></html>
`;
