import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
// `vite dev` is only for working on the inbox; the sink serves the built bundle (ADR-160).
const mailsimUrl = process.env.MAILSIM_URL ?? "http://127.0.0.1:5580";

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5574,
    allowedHosts: [".localhost"],
    fs: { allow: [resolve(here, "../..")] },
    proxy: { "/api": { target: mailsimUrl, changeOrigin: true } },
  },
  preview: { port: 5574, proxy: { "/api": { target: mailsimUrl, changeOrigin: true } } },
  build: { outDir: resolve(here, "../../services/mailsim/web/dist"), emptyOutDir: true },
});
