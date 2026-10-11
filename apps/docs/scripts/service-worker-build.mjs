import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeServiceWorker({ outDir }) {
  const files = await readdir(outDir, { recursive: true });
  const htmlFiles = files.filter((file) => file.endsWith(".html")).toSorted();
  const template = await readFile(new URL("./service-worker.js", import.meta.url), "utf8");
  const fonts = ["/fonts/Inter-Variable-latin.woff2", "/fonts/Inter-Variable-latin-ext.woff2"];
  const hash = createHash("sha256").update(template);
  for (const file of fonts) hash.update(await readFile(path.join(outDir, file)));
  for (const file of htmlFiles) hash.update(file).update(await readFile(path.join(outDir, file)));
  const version = hash.digest("hex").slice(0, 16);
  for (const file of htmlFiles) {
    const target = path.join(outDir, file);
    await writeFile(
      target,
      (await readFile(target, "utf8")).replace(
        /name="docs-build" content="[^"]*"/,
        `name="docs-build" content="${version}"`,
      ),
    );
  }
  const home = await readFile(path.join(outDir, "index.html"), "utf8");
  const styles = [...home.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...home.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
  const offline = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Offline | LangWatch Docs</title>${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><main class="docs-offline"><h1>You are offline</h1><p>Previously opened pages are available offline. Reconnect to open this page.</p><a href="/introduction">Return to the documentation</a></main></body></html>`;
  await writeFile(path.join(outDir, "offline.html"), offline);
  const worker = template
    .replace("__DOCS_VERSION__", version)
    .replace(
      "const PRECACHE = [];",
      `const PRECACHE = ${JSON.stringify([...styles, ...scripts, ...fonts, "/offline.html"])};`,
    );
  await writeFile(path.join(outDir, "sw.js"), worker);
}
