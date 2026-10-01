import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` is only for working on the console; analyticssim serves the built bundle (ADR-160).
const analyticssimUrl = process.env.ANALYTICSSIM_URL ?? "http://127.0.0.1:5596";
const proxy = { "/_sim/api": { target: analyticssimUrl, changeOrigin: true } };

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5577,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy,
  },
  preview: { port: 5577, proxy },
  build: { outDir: resolve(here, "../../services/analyticssim/web/dist"), emptyOutDir: true },
});
