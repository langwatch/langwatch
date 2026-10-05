// Browser use-proof for feat/chart-sandbox-origin (not committed).
// Serves the REAL frame document + headers from the branch code and a host
// page carrying the REAL enforced production app CSP, then renders a widget
// that imports third-party packages from esm.sh inside sandbox="allow-scripts".
import http from "node:http";
import { chromium } from "playwright";
import { buildSecurityHeaders } from "../src/server/securityHeaders";
import {
  buildChartFrameHeaders,
  buildChartFrameHtml,
  CHART_FRAME_PATH,
} from "../src/server/chartSandboxFrame";

const WIDGET = `
import dayjs from "dayjs";
import { ErrorBoundary } from "react-error-boundary";
import { LineChart, Line, XAxis, YAxis } from "recharts";

function Widget() {
  const [lazyText, setLazyText] = React.useState("pending");
  React.useEffect(() => {
    import("lodash-es").then((m) => setLazyText("lodash-es says " + m.kebabCase("Dynamic Import Works")));
  }, []);
  const data = [1, 3, 2, 5, 4].map((v, i) => ({ n: "d" + i, v }));
  return (
    <ErrorBoundary fallback={<div>boundary failed</div>}>
      <div id="proof">dayjs says {dayjs("2024-01-15").format("MMMM D, YYYY")}</div>
      <div id="lazy">{lazyText}</div>
      <LineChart width={320} height={160} data={data}>
        <Line dataKey="v" stroke="#2563eb" isAnimationActive={false} />
        <XAxis dataKey="n" /><YAxis />
      </LineChart>
    </ErrorBoundary>
  );
}
export default React.memo(Widget);
`;

const HOST = `<!doctype html><html><body style="font-family:system-ui">
<h3>Host page under enforced production CSP</h3>
<iframe id="f" sandbox="allow-scripts" src="${CHART_FRAME_PATH}" style="width:420px;height:260px;border:1px solid #ccc"></iframe>
<pre id="log"></pre>
<script>
  const log = (m) => { document.getElementById("log").textContent += m + "\\n"; };
  document.addEventListener("securitypolicyviolation", (e) => log("HOST CSP VIOLATION " + e.violatedDirective + " " + e.blockedURI));
  const f = document.getElementById("f");
  f.addEventListener("load", () => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => { const d = e.data; if (d && d.type !== "lw:heartbeat") log("frame -> " + JSON.stringify(d).slice(0, 200)); };
    f.contentWindow.postMessage({ type: "lw:init", dashboardContext: { theme: "light" }, params: {}, source: ${JSON.stringify(WIDGET)} }, "*", [ch.port2]);
    log("posted lw:init");
  });
</script></body></html>`;

const appHeaders = buildSecurityHeaders({ dev: false, assetOrigin: null });
const frameHeaders = buildChartFrameHeaders();
const frameHtml = buildChartFrameHtml();

const server = http.createServer((req, res) => {
  for (const [k, v] of Object.entries(appHeaders)) res.setHeader(k, v);
  if (req.url === CHART_FRAME_PATH) {
    for (const [k, v] of Object.entries(frameHeaders)) res.setHeader(k, v);
    res.end(frameHtml);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(HOST);
});

await new Promise<void>((r) => server.listen(4799, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 420 } });
const consoleLines: string[] = [];
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));

await page.goto("http://localhost:4799/");
const frame = page.frameLocator("#f");
let proofText: string | null = null;
try {
  await frame.locator("#proof").waitFor({ timeout: 30000 });
  proofText = await frame.locator("#proof").textContent();
} catch {}
let lazyText: string | null = null;
try {
  await frame.locator("#lazy", { hasText: "lodash-es says" }).waitFor({ timeout: 30000 });
  lazyText = await frame.locator("#lazy").textContent();
} catch {}
console.log("lazy text:", lazyText);
const svgCount = await frame.locator("svg.recharts-surface").count();
const errPanel = await frame.locator("#lw-compile-error").textContent();
await page.screenshot({ path: process.env.CLAUDE_JOB_DIR + "/tmp/browser-proof.png" });

console.log("proof text:", proofText);
console.log("recharts svg count:", svgCount);
console.log("error panel:", JSON.stringify(errPanel));
console.log("host log:\n" + (await page.locator("#log").textContent()));
console.log("console:\n" + consoleLines.join("\n"));
const violations = consoleLines.filter((l) => /Content Security Policy|CSP/i.test(l));
console.log("CSP violations:", violations.length);
await browser.close();
server.close();
process.exit(violations.length === 0 && !!proofText?.includes("January 15, 2024") && svgCount > 0 ? 0 : 1);
