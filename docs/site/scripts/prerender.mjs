import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STATIC_DIRS, STATIC_FILES } from "../docs-dev.mjs";
import { pageMarkdown } from "../docs-markdown.mjs";
import { buildNav } from "../docs-nav.mjs";
import { llmsDirectory, pageTargets } from "../docs-output.mjs";
import { readRedirects } from "../docs-routing.mjs";
import { searchEntry } from "../docs-search.mjs";
import { readBuildOptions } from "../scripts/options.mjs";
import { render } from "../src/entry-server.tsx";

const siteRoot = fileURLToPath(new URL("..", import.meta.url));
const { outDir: dist } = readBuildOptions();
const docsRoot = path.resolve(siteRoot, "..");
function escapeHtml({ text }) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
const template = await readFile(path.join(dist, "index.html"), "utf8");
const nav = buildNav({ docsRoot });
const { pages } = nav;

async function copyMarkdown({ slug }) {
  await mkdir(path.dirname(path.join(dist, slug)), { recursive: true });
  await writeFile(path.join(dist, `${slug}.md`), pageMarkdown({ docsRoot, slug }));
}

await writeFile(path.join(dist, "redirects.json"), JSON.stringify(readRedirects({ docsRoot })));
await writeFile(path.join(dist, "llms.txt"), llmsDirectory({ nav }));
const searchIndex = [];
let compiled = 0;
const skipped = [];
for (const slug of Object.keys(pages)) {
  try {
    const { html, title, description, examples, headings } = await render({ slug });
    const head = `<title>${escapeHtml({ text: title })}</title>${description ? `<meta name="description" content="${escapeHtml({ text: description })}" />` : ""}`;
    const page = template
      .replace("<!--head-->", head)
      .replace("<!--app-->", html)
      .replace(
        "</body>",
        `<script>window.__DOCS_SLUG__=${JSON.stringify(slug)}${examples ? `;window.__DOCS_EXAMPLES__=${JSON.stringify(examples)}` : ""}</script></body>`,
      );
    searchIndex.push(searchEntry({ nav, slug, html, headings }));
    await copyMarkdown({ slug });
    const targets = pageTargets({ slug });
    for (const target of targets) {
      await mkdir(path.dirname(path.join(dist, target)), { recursive: true });
      await writeFile(path.join(dist, target), page);
    }
    compiled += 1;
  } catch (error) {
    skipped.push({ slug, reason: `render: ${String(error?.message ?? error).split("\n")[0]}` });
  }
}

await writeFile(path.join(dist, "search-index.json"), JSON.stringify(searchIndex));

const missing = await render({ slug: "404" });
const notFound = template
  .replace("<!--head-->", "<title>Not found</title>")
  .replace("<!--app-->", missing.html)
  .replace("</body>", `<script>window.__DOCS_SLUG__="404"</script></body>`);
await writeFile(path.join(dist, "404.html"), notFound);

for (const name of [...STATIC_DIRS, ...STATIC_FILES]) {
  if (existsSync(path.join(docsRoot, name)))
    await cp(path.join(docsRoot, name), path.join(dist, name), { recursive: true });
}

const reasons = new Map();
for (const { slug, reason } of skipped) {
  const entry = reasons.get(reason) ?? { count: 0, example: slug };
  entry.count += 1;
  reasons.set(reason, entry);
}
console.log(`\n[docs-site] compiled: ${compiled}, skipped: ${skipped.length}`);
for (const [reason, { count, example }] of [...reasons]
  .toSorted((a, b) => b[1].count - a[1].count)
  .slice(0, 15)) {
  console.log(`  ${count}x ${reason} (e.g. ${example}.mdx)`);
}
await writeFile(path.join(dist, "skipped.json"), JSON.stringify(skipped, null, 2));

if (skipped.length > 0)
  throw new Error(`Documentation rendering failed for ${skipped.length} pages`);
