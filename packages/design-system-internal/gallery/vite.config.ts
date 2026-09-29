import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;

export default defineConfig({
  root: here,
  plugins: [react()],
  server: { port: 5571, fs: { allow: [resolve(here, "..")] } },
  preview: { port: 5571 },
  build: { outDir: resolve(here, "../dist/gallery"), emptyOutDir: true },
});
