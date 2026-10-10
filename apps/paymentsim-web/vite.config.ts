import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` is only for working on the console; paymentsim serves the built bundle (ADR-160).
const paymentsimUrl = process.env.PAYMENTSIM_URL ?? "http://127.0.0.1:5599";
const proxy = { "/_sim/api": { target: paymentsimUrl, changeOrigin: true } };

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5583,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy,
  },
  preview: { port: 5583, proxy },
  build: { outDir: resolve(here, "../../services/paymentsim/web/dist"), emptyOutDir: true },
});
