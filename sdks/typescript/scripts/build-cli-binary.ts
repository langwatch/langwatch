#!/usr/bin/env bun
/**
 * Compiles the `langwatch` CLI into a single self-contained native binary with
 * Bun (`bun build --compile`).
 *
 * WHY: the Langy agent's ONLY interface to LangWatch is shelling out to the
 * `langwatch` CLI, so every tool call the model makes is a fresh process spawn.
 * Under Node that costs ~120-190ms of interpreter + module-graph boot before a
 * single line of our code runs, and the agent makes several CLI calls per turn.
 * A Bun-compiled binary embeds a pre-parsed bytecode snapshot of the whole
 * bundle, which collapses that to single-digit milliseconds.
 *
 * This is ADDITIVE. The `tsup` build (`pnpm build`) remains the way the npm
 * package is produced and is what contributors and CI use; this script only
 * produces an extra artifact for the Langy worker image. Keep the two in step:
 * the `define` and the inlined workspace package below mirror tsup.config.ts.
 *
 * Usage:
 *   bun run build:binary                      # host platform
 *   bun run build:binary -- --target=bun-linux-arm64 --outfile dist/bin/langwatch
 */
import { rmSync } from "node:fs";
import packageJson from "../package.json" with { type: "json" };

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};

const target = flag("target");
const outfile = flag("outfile") ?? "dist/bin/langwatch";

// `bun build --compile` refuses to overwrite a running/existing binary cleanly
// on some platforms; remove it first so repeat builds are deterministic.
rmSync(outfile, { force: true });

const result = await Bun.build({
  entrypoints: ["./src/cli/index.ts"],
  // Bytecode compilation moves parse time from run-time to build-time — this is
  // most of the startup win, so it is not optional.
  compile: { outfile, ...(target ? { target } : {}), bytecode: true },
  // Mirrors tsup.config.ts. `__CLI_VERSION__` is a bare identifier in
  // src/cli/program.ts; without this define the binary COMPILES FINE and then
  // dies at runtime with `ReferenceError: __CLI_VERSION__ is not defined` on
  // the very first command. Do not remove.
  define: {
    __CLI_VERSION__: JSON.stringify(packageJson.version),
  },
  // @langwatch/cli-cards is a source-only workspace package (the typed
  // domain-error / card contract). It must be inlined, exactly as tsup does
  // via `noExternal`, or the binary cannot resolve it at runtime. Bun bundles
  // all imports by default, so this is implicit — verify a fresh binary with
  // `dist/bin/langwatch --version` after building.
  throw: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const size = Bun.file(outfile).size;
console.log(
  `built ${outfile} (${(size / 1024 / 1024).toFixed(1)} MB)${target ? ` for ${target}` : ""}`,
);
