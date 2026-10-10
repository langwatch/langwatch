/**
 * The LangWatch loading screen as plain HTML, on screen before any script runs: over every
 * `index.html` until React has drawn, then faded off, and in place of Vite's "Bundling in
 * progress" page. It is the design system's LoadingScreen at rest, so no seam shows.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  LANG_PATH,
  LOGO_LINES_PATH,
  LOGO_PLATE_PATH,
  WATCH_PATH,
} from "@langwatch/design-system/logo-paths";
import type { Plugin } from "vite";

// The values of bg.page and logo.* in each mode, and the ground's static floor from
// ambient-ground.css: no stylesheet has loaded yet, so they are written out here.
const STYLE = `<style data-boot-splash>
  .lw-boot { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    padding-bottom: 64px; background: #f1f5f9; overflow: hidden; z-index: 1400;
    transition: opacity 320ms cubic-bezier(0.4, 0, 0.2, 1); }
  .lw-boot--out { opacity: 0; pointer-events: none; }
  .lw-boot::before { content: ""; position: absolute; inset: 0; opacity: 0.3;
    background: linear-gradient(135deg, #ffffff 0%, #ffaf6e 35%, #cddcf9 72%, #ffffff 100%); }
  .lw-boot::after { content: ""; position: absolute; inset: 0; background: radial-gradient(circle 42vw
    at 50% 45%, #ffffff 0%, #ffffff 30%, rgba(255,255,255,0.7) 56%, rgba(255,255,255,0) 90%); }
  .lw-boot svg { position: relative; z-index: 1; }
  .lw-boot .face { fill: white; } .lw-boot .mark { fill: #213b41; }
  .lw-boot .word { fill: #1d293d; } .lw-boot .word-muted { fill: #314158; }
  .dark .lw-boot { background: #10101a; }
  .dark .lw-boot::before { opacity: 1; background:
    radial-gradient(circle at 50% 30%, rgba(91, 141, 239, 0.35), transparent 42%),
    radial-gradient(circle at 58% 72%, rgba(201, 123, 58, 0.22), transparent 48%); }
  .dark .lw-boot::after { display: none; }
  .dark .lw-boot .face { fill: transparent; } .dark .lw-boot .mark { fill: #f1f5f9; }
  .dark .lw-boot .word { fill: #f1f5f9; } .dark .lw-boot .word-muted { fill: #cbd5e1; }
</style>`;

// next-themes' choice (its `theme` key, "system" by default) applied before first paint.
const THEME_SCRIPT = `<script data-boot-splash>(function () {
  var stored = null;
  try { stored = localStorage.getItem("theme"); } catch (e) {}
  var dark = stored === "dark" ||
    (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.add(dark ? "dark" : "light");
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();</script>`;

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="186" height="45.6" viewBox="0 0 155 38"
  fill="none" role="img" aria-label="LangWatch">
  <g transform="translate(3 3) scale(0.6)">
    <path class="face" d="${LOGO_PLATE_PATH}" /><path class="mark" d="${LOGO_LINES_PATH}" />
  </g>
  <path class="word" d="${LANG_PATH}" /><path class="word-muted" d="${WATCH_PATH}" />
</svg>`;

/** What goes in `<head>`: the styles and the colour-mode script. */
export const BOOT_SPLASH_HEAD = `${STYLE}\n${THEME_SCRIPT}`;

/** The screen itself, fixed over the page. */
export const BOOT_SPLASH_BODY = `<div id="lw-boot" class="lw-boot" data-testid="boot-splash" aria-busy="true">${LOGO}</div>`;

// Fades the screen off once React has drawn into #root (a page with no root, as the bundling
// page, keeps it); reduced motion drops it at once.
const HAND_OFF_SCRIPT = `<script data-boot-splash>(function () {
  var splash = document.getElementById("lw-boot");
  var root = document.getElementById("root");
  if (!splash || !root) return;
  function leave() {
    observer.disconnect();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return splash.remove();
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      splash.classList.add("lw-boot--out");
      splash.addEventListener("transitionend", function () { splash.remove(); });
      setTimeout(function () { splash.remove(); }, 720);
    }); });
  }
  var observer = new MutationObserver(function () { if (root.firstElementChild) leave(); });
  observer.observe(root, { childList: true });
})();</script>`;

const FALLBACK_MARKER = "__vite_is_fallback_page__";

/**
 * Vite's fallback page with our screen in its body. Its scripts stay: they reload the page
 * once the bundle is ready.
 */
export function brandFallbackPage(html: string): string {
  if (!html.includes(FALLBACK_MARKER)) return html;
  return html
    .replace(/<style>[\s\S]*?<\/style>/, BOOT_SPLASH_HEAD)
    .replace(/<body>[\s\S]*<\/body>/, `<body style="margin:0">${BOOT_SPLASH_BODY}</body>`);
}

/** Holds back an HTML response's body so Vite's fallback page can be rewritten whole. */
function rewriteFallbackResponses(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (!req.headers.accept?.includes("text/html")) return next();
  const end = res.end.bind(res);
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
      const html = chunk.toString();
      const branded = brandFallbackPage(html);
      if (branded !== html) {
        res.setHeader("Content-Length", Buffer.byteLength(branded));
        res.removeHeader("ETag");
        return end(branded);
      }
    }
    return (end as (...args: unknown[]) => ServerResponse)(chunk, ...rest);
  }) as ServerResponse["end"];
  next();
}

export function bootSplash(): Plugin {
  return {
    name: "langwatch:boot-splash",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html
          .replace("</head>", `${BOOT_SPLASH_HEAD}\n  </head>`)
          .replace(
            '<div id="root"></div>',
            `<div id="root"></div>\n    ${BOOT_SPLASH_BODY}\n    ${HAND_OFF_SCRIPT}`,
          ),
    },
    // Registered before Vite's own middlewares, so it wraps the response they send.
    configureServer: (server) => {
      server.middlewares.use(rewriteFallbackResponses);
    },
  };
}
