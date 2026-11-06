// Throwaway diagnostic: log every failed or non-2xx browser request and every mock route error.
const fs = require("node:fs");
const path = require("node:path");

const store = path.resolve(__dirname, "../../node_modules/.pnpm");
for (const dir of fs.readdirSync(store).filter((d) => d.startsWith("@vitest+browser-playwright@"))) {
  const file = path.join(store, dir, "node_modules/@vitest/browser-playwright/dist/index.js");
  let src = fs.readFileSync(file, "utf8");
  const pageHook = `if (process.env.VITEST_PW_DEBUG) {`;
  if (!src.includes(pageHook)) throw new Error(`page hook not found in ${file}`);
  src = src.replace(
    pageHook,
    `page.on("response", (r) => { if (r.status() >= 300) console.error("[diag-resp]", r.status(), r.statusText(), r.url()); });
		page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error("[diag-console]", m.type(), m.text()); });
		page.on("pageerror", (e) => console.error("[diag-pageerror]", e));
		${pageHook}`,
  );
  const resolveCall = `const exports = Object.keys(await module.resolve());`;
  if (!src.includes(resolveCall)) throw new Error(`resolve call not found in ${file}`);
  src = src.replace(
    resolveCall,
    `console.error("[diag-route] manual", module.url, route.request().url());
							let exports;
							try { exports = Object.keys(await module.resolve()); } catch (e) { console.error("[diag-route] resolve failed", module.url, e); throw e; }`,
  );
  fs.rmSync(file); // break the store hardlink
  fs.writeFileSync(file, src);
  console.log(`patched ${file}`);
}
