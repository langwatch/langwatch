import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` is only for working on the console; idpsim serves the built bundle (ADR-160).
const idpsimUrl = process.env.IDPSIM_URL ?? "http://127.0.0.1:5565";
const proxy = {
  "/api": { target: idpsimUrl, changeOrigin: true },
  "/control": { target: idpsimUrl, changeOrigin: true },
};

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5576,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy,
  },
  preview: { port: 5576, proxy },
  build: { outDir: resolve(here, "../../services/idpsim/web/dist"), emptyOutDir: true },
});
