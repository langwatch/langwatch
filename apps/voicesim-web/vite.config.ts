import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` is only for working on the console; voicesim serves the built bundle (ADR-160).
const voicesimUrl = process.env.VOICESIM_URL ?? "http://127.0.0.1:5591";
const proxy = { "/_sim/api": { target: voicesimUrl, changeOrigin: true } };

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5578,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy,
  },
  preview: { port: 5578, proxy },
  build: { outDir: resolve(here, "../../services/voicesim/web/dist"), emptyOutDir: true },
});
