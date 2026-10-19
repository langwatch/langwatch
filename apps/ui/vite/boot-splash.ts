/**
 * The LangWatch loading screen as plain HTML with the ground's live shader inline: the same
 * screen on Vite's "Bundling in progress" page and over every `index.html`, held until the app
 * draws a real page, then faded off. It is the design system's LoadingScreen, so no seam shows.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import {
  LANG_PATH,
  LOGO_LINES_PATH,
  LOGO_PLATE_PATH,
  WATCH_PATH,
} from "@langwatch/design-system/logo-paths";
import { build, type Plugin } from "vite";

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
  .lw-boot-shader { position: absolute; inset: 0; opacity: 0;
    transition: opacity 700ms ease 120ms; }
  .lw-boot-shader[data-live] { opacity: 0.4; }
  .lw-boot svg { position: relative; z-index: 1; }
  .lw-boot-note { position: absolute; z-index: 1; left: 0; right: 0; top: calc(50% + 12px);
    margin: 0; text-align: center; font: 13px/18px Inter, system-ui, sans-serif; color: #475569;
    opacity: 0; transition: opacity 400ms ease; }
  .lw-boot-note[data-on] { opacity: 1; }
  .dark .lw-boot-note { color: #9ca3af; }
  .lw-boot .face { fill: white; } .lw-boot .mark { fill: #213b41; }
  .lw-boot .word { fill: #1d293d; } .lw-boot .word-muted { fill: #314158; }
  .dark .lw-boot { background: #10101a; }
  .dark .lw-boot::before { opacity: 1; background:
    radial-gradient(circle at 50% 30%, rgba(91, 141, 239, 0.35), transparent 42%),
    radial-gradient(circle at 58% 72%, rgba(201, 123, 58, 0.22), transparent 48%); }
  .dark .lw-boot::after { display: none; }
  .dark .lw-boot-shader { inset: auto; top: -12%; left: 50%; width: 130%; height: 124%;
    transform: translateX(-50%);
    -webkit-mask-image: radial-gradient(ellipse 62% 70% at 50% 42%, black 0%, black 30%,
      rgba(0,0,0,0.55) 62%, rgba(0,0,0,0.16) 84%, transparent 100%);
    mask-image: radial-gradient(ellipse 62% 70% at 50% 42%, black 0%, black 30%,
      rgba(0,0,0,0.55) 62%, rgba(0,0,0,0.16) 84%, transparent 100%); }
  .dark .lw-boot-shader[data-live] { opacity: 0.55; }
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
export const BOOT_SPLASH_BODY = `<div id="lw-boot" class="lw-boot" data-testid="boot-splash" aria-busy="true"><div id="lw-boot-shader" class="lw-boot-shader" aria-hidden="true"></div>${LOGO}<p id="lw-boot-note" class="lw-boot-note" role="status"></p></div>`;

// Fades the screen off once the app has drawn a real page into #root: it stays over the app's
// own loading screen, so a slow session or API read shows one screen, not two. A page with no
// root (the bundling page) keeps it; reduced motion drops it at once.
/** The API's health route, as `UI_API_HEALTH_PATH` in @langwatch/browser-host names it. */
const HEALTH_PATH = "/api/health";

const HAND_OFF_SCRIPT = `<script data-boot-splash>(function () {
  var splash = document.getElementById("lw-boot");
  var root = document.getElementById("root");
  if (!splash || !root) return;
  function leave() {
    observer.disconnect();
    clearInterval(countdown);
    document.dispatchEvent(new Event("lw-boot:done"));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return splash.remove();
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      splash.classList.add("lw-boot--out");
      splash.addEventListener("transitionend", function () { splash.remove(); });
      setTimeout(function () { splash.remove(); }, 720);
    }); });
  }
  // The theme provider writes a <style> and a <script> into the root before any page: not drawn.
  function drawn() {
    var page = Array.prototype.some.call(root.children, function (child) {
      return child.tagName !== "STYLE" && child.tagName !== "SCRIPT";
    });
    return page && !root.querySelector('[data-testid="loading-screen"]');
  }
  // A slow start says what it is doing: it asks the API's health route, easing from 2s to 10s,
  // and counts down to each retry, so a server that never answers never looks like a stuck page.
  var note = document.getElementById("lw-boot-note");
  var wait = 2000;
  var countdown = 0;
  function say(text) {
    if (!note || !splash.isConnected) return;
    note.textContent = text;
    note.setAttribute("data-on", "");
  }
  function probe() {
    if (!splash.isConnected) return;
    say("Connecting to the server\\u2026");
    fetch("${HEALTH_PATH}", { cache: "no-store" })
      .then(function (response) { return response.ok; }, function () { return false; })
      .then(function (answered) {
        if (answered) return say("Connected. Opening LangWatch\\u2026");
        var left = Math.round(wait / 1000);
        clearInterval(countdown);
        say("Can't reach the server yet. Trying again in " + left + "s\\u2026");
        countdown = setInterval(function () {
          left -= 1;
          if (left > 0) return say("Can't reach the server yet. Trying again in " + left + "s\\u2026");
          clearInterval(countdown);
          probe();
        }, 1000);
        wait = Math.min(wait * 2, 10000);
      });
  }
  setTimeout(probe, 3000);
  var observer = new MutationObserver(function () { if (drawn()) leave(); });
  observer.observe(root, { childList: true, subtree: true });
})();</script>`;

/** The boot ground's entry, resolved on use (a test may load this module from a non-file URL). */
function bootGroundEntry(): string {
  return fileURLToPath(new URL("../src/boot-ground.ts", import.meta.url));
}

/** The live mesh or warp as one classic script, from the official React-free shader package. */
export async function bundleBootGround({ minify }: { minify: boolean }): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    build: {
      write: false,
      minify,
      sourcemap: false,
      emptyOutDir: false,
      lib: { entry: bootGroundEntry(), formats: ["iife"], name: "langwatchBootGround" },
    },
  });
  for (const output of Array.isArray(result) ? result : [result]) {
    if (!("output" in output)) continue;
    const chunk = output.output.find((item) => item.type === "chunk");
    if (chunk && chunk.type === "chunk") return chunk.code;
  }
  throw new Error("The boot ground bundle produced no script");
}

/** The script inline, so it runs on Vite's bundling page too, where no module can load yet. */
const groundTag = (code: string) =>
  `<script data-boot-splash>${code.replaceAll("</script", "<\\/script")}</script>`;

const FALLBACK_MARKER = "__vite_is_fallback_page__";

// On Vite's bundling page the wait is the build, so the note says so after a moment. Vite
// reloads this page once, when its first build ends, so a page that missed that message asks
// the server itself every two seconds and reloads once it serves the app.
const BUILDING_NOTE = `<script data-boot-splash>setTimeout(function () {
  var note = document.getElementById("lw-boot-note");
  if (note) { note.textContent = "Building the app\\u2026"; note.setAttribute("data-on", ""); }
}, 1500);
setInterval(function () {
  fetch(location.href, { headers: { accept: "text/html" }, cache: "no-store" })
    .then(function (response) { return response.ok ? response.text() : ""; })
    .then(function (html) {
      if (html && html.indexOf("${FALLBACK_MARKER}") === -1) location.reload();
    })
    .catch(function () {});
}, 2000);</script>`;

/**
 * Vite's fallback page with our screen in its body. Its scripts stay: they reload the page
 * once the bundle is ready, and the live ground carries on across the reload.
 */
export function brandFallbackPage({
  html,
  ground = "",
}: {
  html: string;
  ground?: string;
}): string {
  if (!html.includes(FALLBACK_MARKER)) return html;
  const body = `${BOOT_SPLASH_BODY}${BUILDING_NOTE}${ground ? groundTag(ground) : ""}`;
  return html
    .replace(/<style>[\s\S]*?<\/style>/, () => `<meta charset="utf-8">${BOOT_SPLASH_HEAD}`)
    .replace(/<body>[\s\S]*<\/body>/, () => `<body style="margin:0">${body}</body>`);
}

/** Holds back an HTML response's body so Vite's fallback page can be rewritten whole. */
function rewriteFallbackResponses({ ground }: { ground: () => Promise<string> }) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.headers.accept?.includes("text/html")) return next();
    const code = await ground().catch(() => "");
    const end = res.end.bind(res);
    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
        const html = chunk.toString();
        const branded = brandFallbackPage({ html, ground: code });
        if (branded !== html) {
          res.setHeader("Content-Length", Buffer.byteLength(branded));
          res.removeHeader("ETag");
          return end(branded);
        }
      }
      return (end as (...args: unknown[]) => ServerResponse)(chunk, ...rest);
    }) as ServerResponse["end"];
    next();
  };
}

export function bootSplash({
  bundleGround = bundleBootGround,
}: {
  /** Builds the live ground's script; a test hands in its own. */
  bundleGround?: typeof bundleBootGround;
} = {}): Plugin {
  let ground: Promise<string> | null = null;
  let minify = false;
  const groundScript = () => (ground ??= bundleGround({ minify }));
  return {
    name: "langwatch:boot-splash",
    configResolved: (config) => {
      minify = config.command === "build";
    },
    transformIndexHtml: {
      order: "pre",
      handler: async (html) => {
        // A function replacement, so a `$` pattern in the bundled script stays literal text.
        const ground = groundTag(await groundScript());
        return html
          .replace("</head>", () => `${BOOT_SPLASH_HEAD}\n  </head>`)
          .replace(
            '<div id="root"></div>',
            () =>
              `<div id="root"></div>\n    ${BOOT_SPLASH_BODY}\n    ${HAND_OFF_SCRIPT}\n    ${ground}`,
          );
      },
    },
    // Registered before Vite's own middlewares, so it wraps the response they send.
    configureServer: (server) => {
      void groundScript();
      server.middlewares.use(rewriteFallbackResponses({ ground: groundScript }));
    },
  };
}
