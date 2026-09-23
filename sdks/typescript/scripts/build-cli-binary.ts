#!/usr/bin/env bun
/**
 * Compiles the `langwatch` CLI into a native binary (`bun build --compile`)
 * so Langy's per-tool-call CLI spawn boots in single-digit ms, not Node's
 * ~150ms. Keep this script's `define`/inlined package in step with tsup.config.ts.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import packageJson from "../package.json" with { type: "json" };

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};

const target = flag("target");
// Every binary this repository builds locally lands in <root>/.bin/<name>/<name>,
// which is ignored wholesale. Resolved from this script rather than the working
// directory so the path is the same whoever invokes it; the release workflow
// passes its own --outfile under dist/bin, which packaging already excludes.
const outfile = flag("outfile") ?? resolve(import.meta.dir, "../../..", ".bin/langwatch/langwatch");

// `bun build --compile` refuses to overwrite a running/existing binary cleanly
// on some platforms; remove it first so repeat builds are deterministic.
rmSync(outfile, { force: true });
mkdirSync(dirname(outfile), { recursive: true });

const result = await Bun.build({
  entrypoints: ["./src/cli/index.ts"],
  // Bytecode compilation moves parse time from run-time to build-time — this is
  // most of the startup win, so it is not optional.
  compile: { outfile, ...(target ? { target } : {}), bytecode: true },
  // Minification shrinks the embedded bundle (and therefore the binary) and
  // is safe to combine with bytecode compilation.
  minify: true,
  // Mirrors tsup.config.ts. `__CLI_VERSION__` is a bare identifier in
  // src/cli/program.ts; without this define the binary COMPILES FINE and then
  // dies at runtime with `ReferenceError: __CLI_VERSION__ is not defined` on
  // the very first command. Do not remove.
  define: {
    __CLI_VERSION__: JSON.stringify(packageJson.version),
  },
  // @langwatch/langy-contract/cards is a source-only workspace package (the typed
  // domain-error / card contract). It must be inlined, exactly as tsup does
  // via `noExternal`, or the binary cannot resolve it at runtime. Bun bundles
  // all imports by default, so this is implicit — verify a fresh binary with
  // `.bin/langwatch/langwatch --version` after building.
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
