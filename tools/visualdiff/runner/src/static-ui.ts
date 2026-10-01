import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

import type { BrowserContext } from "playwright";

/** PUBLIC_CONFIG_META is the tag a dev server injects into its shell; the built shell needs it. */
const PUBLIC_CONFIG_META = /<meta name="langwatch-[^"]*" content="[^"]*">/g;

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

/** insideDir resolves a request path under dir, or undefined when it would escape it. */
export const insideDir = ({
  dir,
  pathname,
}: {
  dir: string;
  pathname: string;
}): string | undefined => {
  const root = resolve(dir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const file = resolve(join(root, decoded));
  return file.startsWith(root + sep) ? file : undefined;
};

/** builtShell is the built index.html carrying the public config the dev shell was given. */
export const builtShell = ({ built, devShell }: { built: string; devShell: string }): string => {
  const metas = devShell.match(PUBLIC_CONFIG_META) ?? [];
  return built.replace("</head>", `${metas.join("")}</head>`);
};

/** readBuilt reads files under dir once each; a path the build does not hold reads undefined. */
const readBuilt = (dir: string): ((pathname: string) => Promise<Buffer | undefined>) => {
  const files = new Map<string, Promise<Buffer | undefined>>();
  const load = async (pathname: string): Promise<Buffer | undefined> => {
    const file = insideDir({ dir, pathname });
    if (file === undefined) return undefined;
    const found = await stat(file).catch(() => undefined);
    return found?.isFile() === true ? readFile(file) : undefined;
  };
  return (pathname) => {
    const known = files.get(pathname);
    if (known !== undefined) return known;
    const loading = load(pathname).catch(() => undefined);
    files.set(pathname, loading);
    return loading;
  };
};

/** ServeBuiltUi installs the prebuilt UI on one context. */
export type ServeBuiltUi = (context: BrowserContext) => Promise<void>;

/**
 * prepareBuiltUi reads the dev shell's public config once and serves the prebuilt shell for every
 * document, and every file the build holds, on the page's own origin. /api, /sandbox and
 * whatever the build does not hold still reach the stack.
 */
export const prepareBuiltUi = async ({
  context,
  baseUrl,
  dir,
}: {
  context: BrowserContext;
  baseUrl: string;
  dir: string;
}): Promise<ServeBuiltUi> => {
  const origin = new URL(baseUrl).origin;
  const probe = await context.newPage();
  const response = await probe.goto(`${baseUrl}/`, { waitUntil: "commit", timeout: 30_000 });
  const devShell = (await response?.text().catch(() => "")) ?? "";
  await probe.close();
  const shell = builtShell({ built: await readFile(join(dir, "index.html"), "utf8"), devShell });
  const read = readBuilt(dir);
  return async (target) => {
    await target.route(
      (url) =>
        url.origin === origin &&
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/sandbox/"),
      async (route) => {
        const request = route.request();
        if (request.method() !== "GET") return route.continue();
        if (request.resourceType() === "document") {
          return route.fulfill({ status: 200, contentType: "text/html", body: shell });
        }
        const pathname = new URL(request.url()).pathname;
        const body = await read(pathname);
        if (body === undefined) return route.continue();
        const contentType = CONTENT_TYPES[extname(pathname)] ?? "application/octet-stream";
        return route.fulfill({ status: 200, contentType, body });
      },
    );
  };
};
