import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` only: the daemon behind the hub's hostname answers /api and /v1.
const daemon = process.env.HAVEN_HUB_URL ?? "https://hub.langwatch.localhost";
const proxy = { target: daemon, changeOrigin: true, secure: false };

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5572,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy: { "/api": proxy, "/v1": proxy },
  },
  preview: { port: 5572, allowedHosts: [".localhost"] },
  build: {
    outDir: resolve(here, "../../tools/thuishaven/adapters/dashboard/web/dist"),
    emptyOutDir: true,
  },
});
