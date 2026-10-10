import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The orb alone, for built-UI haven stacks (ADR-064, 2026-10-10): tools/dev-runtime builds it in
 * memory and serves it beside the api. Never written to disk, so the app's bundle never holds it.
 */
export default defineConfig({
  root: path.resolve(import.meta.dirname, ".."),
  publicDir: false,
  logLevel: "warn",
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { dedupe: ["zod"] },
  build: {
    write: false,
    reportCompressedSize: false,
    lib: {
      entry: path.join(import.meta.dirname, "haven-orb", "orb-client.ts"),
      formats: ["es"],
      fileName: () => "orb.js",
    },
  },
});
