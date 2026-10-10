import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` is only for working on the console; outboundsim serves the built bundle (ADR-160).
const outboundsimUrl = process.env.OUTBOUNDSIM_URL ?? "http://127.0.0.1:5597";
const proxy = { "/_sim/api": { target: outboundsimUrl, changeOrigin: true } };

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5582,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy,
  },
  preview: { port: 5582, proxy },
  build: { outDir: resolve(here, "../../services/outboundsim/web/dist"), emptyOutDir: true },
});
