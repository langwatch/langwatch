import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { STATIC_DIRS, STATIC_FILES, createViteConfig, docsRoot } from "../vite.config.mjs";
import { buildNav } from "../docs-nav.mjs";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(siteRoot, "dist");
const ssrDir = path.join(siteRoot, "dist-ssr");
const failures = new Map();

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

await rm(ssrDir, { recursive: true, force: true });
await build({ ...createViteConfig({ failures }), configFile: false, logLevel: "warn" });
await build({
  ...createViteConfig({ failures }),
  configFile: false,
  logLevel: "warn",
  build: { ssr: "src/entry-server.tsx", outDir: ssrDir, emptyOutDir: true },
});

const template = await readFile(path.join(dist, "index.html"), "utf8");
const { render } = await import(pathToFileURL(path.join(ssrDir, "entry-server.js")).href);
const { pages } = buildNav({ docsRoot });

let compiled = 0;
const skipped = [];
for (const slug of Object.keys(pages)) {
  const file = path.join(docsRoot, `${slug}.mdx`);
  if (failures.has(file)) {
    skipped.push({ slug, reason: failures.get(file) });
    continue;
  }
  try {
    const { html, title, description } = await render({ slug });
    const head = `<title>${escapeHtml(title)}</title>${description ? `<meta name="description" content="${escapeHtml(description)}" />` : ""}`;
    const page = template.replace("<!--head-->", head).replace("<!--app-->", html).replace("</body>", `<script>window.__DOCS_SLUG__=${JSON.stringify(slug)}</script></body>`);
    const targets = slug === "introduction" ? ["index.html", `${slug}/index.html`] : [`${slug}/index.html`];
    for (const target of targets) {
      await mkdir(path.dirname(path.join(dist, target)), { recursive: true });
      await writeFile(path.join(dist, target), page);
    }
    compiled += 1;
  } catch (error) {
    skipped.push({ slug, reason: `render: ${String(error?.message ?? error).split("\n")[0]}` });
  }
}

const notFound = template.replace("<!--head-->", "<title>Not found</title>").replace("<!--app-->", "");
await writeFile(path.join(dist, "404.html"), notFound);

for (const name of [...STATIC_DIRS, ...STATIC_FILES]) {
  if (existsSync(path.join(docsRoot, name))) await cp(path.join(docsRoot, name), path.join(dist, name), { recursive: true });
}
await rm(ssrDir, { recursive: true, force: true });

const reasons = new Map();
for (const { slug, reason } of skipped) {
  const entry = reasons.get(reason) ?? { count: 0, example: slug };
  entry.count += 1;
  reasons.set(reason, entry);
}
console.log(`\n[docs-site] compiled: ${compiled}, skipped: ${skipped.length}`);
for (const [reason, { count, example }] of [...reasons].sort((a, b) => b[1].count - a[1].count).slice(0, 15)) {
  console.log(`  ${count}x ${reason} (e.g. ${example}.mdx)`);
}
await writeFile(path.join(siteRoot, "dist", "skipped.json"), JSON.stringify(skipped, null, 2));
