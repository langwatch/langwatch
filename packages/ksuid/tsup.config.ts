import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  tsconfig: "tsconfig.publish.json",
  format: ["cjs", "esm"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  target: "node20",
  platform: "node",
});
