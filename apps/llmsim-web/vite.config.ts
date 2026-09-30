import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` is only for working on the console; llmsim serves the built bundle (ADR-160).
const llmsimUrl = process.env.LLMSIM_URL ?? "http://127.0.0.1:5595";
const proxy = { "/_sim/api": { target: llmsimUrl, changeOrigin: true } };

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5579,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy,
  },
  preview: { port: 5579, proxy },
  build: { outDir: resolve(here, "../../services/llmsim/web/dist"), emptyOutDir: true },
});
