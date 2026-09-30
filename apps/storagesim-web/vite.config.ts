import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` is only for working on the console; storagesim serves the built bundle (ADR-160).
const storagesimUrl = process.env.STORAGESIM_URL ?? "http://127.0.0.1:5590";

export default defineConfig({
  root: here,
  base: "/_sim/",
  plugins: [react()],
  server: {
    port: 5575,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy: { "/_sim/api": { target: storagesimUrl, changeOrigin: true } },
  },
  preview: { port: 5575, proxy: { "/_sim/api": { target: storagesimUrl, changeOrigin: true } } },
  build: { outDir: resolve(here, "../../services/storagesim/web/dist"), emptyOutDir: true },
});
