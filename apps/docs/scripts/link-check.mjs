import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { resolveRedirect } from "../docs-routing.mjs";

function htmlFiles({ directory }) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles({ directory: file });
    return entry.name.endsWith(".html") ? [file] : [];
  });
}

function attributes({ html, attribute }) {
  const pattern = new RegExp(`\\b${attribute}=["']([^"']*)["']`, "gi");
  return [...html.matchAll(pattern)].map((match) => match[1].replace(/&amp;/g, "&"));
}

function resolveTarget({ href, source, redirects }) {
  let url = new URL(href, `https://docs.langwatch.ai${source}`);
  const visited = new Set();
  while (url.origin === "https://docs.langwatch.ai") {
    if (visited.has(url.pathname)) return { error: "redirect-cycle" };
    visited.add(url.pathname);
    const redirect = resolveRedirect({ pathname: url.pathname, search: url.search, redirects });
    if (!redirect) return { url };
    const target = new URL(redirect, url);
    if (!target.hash) target.hash = url.hash;
    url = target;
  }
  return { external: true };
}

function checkTarget({ outDir, url, ids }) {
  const pathname = decodeURIComponent(url.pathname);
  const target = path.resolve(outDir, `.${pathname}`);
  const withinBuild = target.startsWith(outDir + path.sep) || target === outDir;
  if (!withinBuild) return "outside-build";
  const file = path.extname(target) ? target : path.join(target, "index.html");
  if (!existsSync(file)) return "missing-target";
  if (!statSync(file).isFile()) return "missing-target";
  if (!url.hash || !file.endsWith(".html")) return null;
  if (!ids.has(file))
    ids.set(file, new Set(attributes({ html: readFileSync(file, "utf8"), attribute: "id" })));
  const fragment = decodeURIComponent(url.hash.slice(1));
  return ids.get(file).has(fragment) ? null : "missing-fragment";
}

export function checkLinks({ outDir }) {
  const redirects = JSON.parse(readFileSync(path.join(outDir, "redirects.json"), "utf8"));
  const files = htmlFiles({ directory: outDir });
  const ids = new Map();
  const issues = [];
  let checked = 0;
  for (const file of files) {
    const source = `/${path.relative(outDir, file).replace(/index\.html$/, "")}`;
    const html = readFileSync(file, "utf8");
    const hrefs = [...new Set(attributes({ html, attribute: "href" }))];
    for (const href of hrefs) {
      if (!href || /^(mailto:|tel:|data:|javascript:)/i.test(href)) continue;
      checked += 1;
      const target = resolveTarget({ href, source, redirects });
      if (target.external) continue;
      const code = target.error ?? checkTarget({ outDir, url: target.url, ids });
      if (code) issues.push({ source, href, code });
    }
  }
  return { pages: files.length, checked, issues };
}
