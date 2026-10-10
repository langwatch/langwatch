import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` is only for working on the console; lambdasim serves the built bundle (ADR-160).
const lambdasimUrl = process.env.LAMBDASIM_URL ?? "http://127.0.0.1:5594";
const proxy = { "/_sim/api": { target: lambdasimUrl, changeOrigin: true } };

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5584,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy,
  },
  preview: { port: 5584, proxy },
  build: { outDir: resolve(here, "../../services/lambdasim/web/dist"), emptyOutDir: true },
});
