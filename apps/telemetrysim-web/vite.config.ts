import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` is only for working on the console; telemetrysim serves the built bundle (ADR-160).
const telemetrysimUrl = process.env.TELEMETRYSIM_URL ?? "http://127.0.0.1:5599";
const proxy = { "/_sim/api": { target: telemetrysimUrl, changeOrigin: true } };

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5581,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy,
  },
  preview: { port: 5581, proxy },
  build: { outDir: resolve(here, "../../services/telemetrysim/web/dist"), emptyOutDir: true },
});
