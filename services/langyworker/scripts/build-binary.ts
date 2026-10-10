#!/usr/bin/env bun
/**
 * Builds a self-contained worker binary to minimize per-conversation startup.
 * Mirrors sdks/typescript/scripts/build-cli-binary.ts; accepts --target/--outfile.
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
// directory so the path is the same whoever invokes it; the image build passes
// its own --outfile.
const outfile =
  flag("outfile") ?? resolve(import.meta.dir, "../../..", ".bin/langy-worker/langy-worker");

// `bun build --compile` refuses to overwrite a running/existing binary cleanly
// on some platforms; remove it first so repeat builds are deterministic.
rmSync(outfile, { force: true });
mkdirSync(dirname(outfile), { recursive: true });

const result = await Bun.build({
  entrypoints: ["./src/main.ts"],
  // Bytecode compilation moves parse time from run-time to build-time: this
  // is most of the startup win, so it is not optional.
  compile: { outfile, ...(target ? { target } : {}), bytecode: true },
  minify: true,
  throw: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const size = Bun.file(outfile).size;
console.log(
  `built ${outfile} (${(size / 1024 / 1024).toFixed(1)} MB, v${packageJson.version})${target ? ` for ${target}` : ""}`,
);
