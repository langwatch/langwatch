import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = import.meta.dirname;

// Each simulator page: dev port, the API paths it proxies and the Go process it reads (ADR-160).
const pages = {
  analytics: {
    port: 5577,
    api: ["/_sim/api"],
    url: "ANALYTICSSIM_URL",
    fallback: "http://127.0.0.1:5596",
  },
  idp: {
    port: 5576,
    api: ["/api", "/control"],
    url: "IDPSIM_URL",
    fallback: "http://127.0.0.1:5565",
  },
  lambda: {
    port: 5584,
    api: ["/_sim/api"],
    url: "LAMBDASIM_URL",
    fallback: "http://127.0.0.1:5594",
  },
  llm: { port: 5579, api: ["/_sim/api"], url: "LLMSIM_URL", fallback: "http://127.0.0.1:5595" },
  mail: { port: 5574, api: ["/api"], url: "MAILSIM_URL", fallback: "http://127.0.0.1:5580" },
  mcp: { port: 5585, api: ["/_sim/api"], url: "MCPSIM_URL", fallback: "http://127.0.0.1:5598" },
  outbound: {
    port: 5582,
    api: ["/_sim/api"],
    url: "OUTBOUNDSIM_URL",
    fallback: "http://127.0.0.1:5597",
  },
  payment: {
    port: 5583,
    api: ["/_sim/api"],
    url: "PAYMENTSIM_URL",
    fallback: "http://127.0.0.1:5599",
  },
  storage: {
    port: 5575,
    api: ["/_sim/api"],
    url: "STORAGESIM_URL",
    fallback: "http://127.0.0.1:5590",
  },
  telemetry: {
    port: 5581,
    api: ["/_sim/api"],
    url: "TELEMETRYSIM_URL",
    fallback: "http://127.0.0.1:5599",
  },
  voice: { port: 5578, api: ["/_sim/api"], url: "VOICESIM_URL", fallback: "http://127.0.0.1:5591" },
};
type PageName = keyof typeof pages;

function isPageName(name: string): name is PageName {
  return Object.hasOwn(pages, name);
}

// storagesim serves its page under /_sim/, since a bucket owns every other first segment.
function pageBase(name: string): string {
  return name === "storage" ? "/_sim/" : "/";
}

const outDir = resolve(here, "../../services/sims/simconsole/dist");

// emptyOutDir deletes the tracked .gitkeep that lets go:embed compile before a build.
const keepPlaceholder: Plugin = {
  name: "keep-placeholder",
  closeBundle: () => writeFileSync(resolve(outDir, ".gitkeep"), ""),
};

// `vite build` writes every page; `SIM=<page> vite` works on one page against its simulator.
export default defineConfig(({ command }) => {
  if (command === "build") {
    return {
      root: resolve(here, "src"),
      plugins: [react(), keepPlaceholder],
      build: {
        outDir,
        emptyOutDir: true,
        rollupOptions: {
          input: Object.fromEntries(
            Object.keys(pages).map((name) => [name, resolve(here, "src", name, "index.html")]),
          ),
        },
      },
      experimental: {
        renderBuiltUrl: (filename, { hostType, hostId }) =>
          hostType === "html"
            ? pageBase(hostId.split("/")[0] ?? "") + filename
            : { relative: true },
      },
    };
  }
  const name = process.env.SIM ?? "";
  if (!isPageName(name)) {
    throw new Error(`Set SIM to one of: ${Object.keys(pages).join(", ")}`);
  }
  const page = pages[name];
  const target = process.env[page.url] ?? page.fallback;
  const proxy = Object.fromEntries(page.api.map((path) => [path, { target, changeOrigin: true }]));
  return {
    root: resolve(here, "src", name),
    base: pageBase(name),
    plugins: [react()],
    server: {
      port: page.port,
      allowedHosts: [".localhost"],
      fs: { allow: [resolve(here, "../..")] },
      proxy,
    },
    preview: { port: page.port, proxy },
  };
});
