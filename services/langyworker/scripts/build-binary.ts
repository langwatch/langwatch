#!/usr/bin/env bun
/**
 * Compiles langy-worker into a single self-contained native binary with Bun
 * (`Bun.build` + `compile`), mirroring sdks/typescript/scripts/build-cli-binary.ts.
 *
 * WHY: the langyagent manager spawns one worker per conversation, and warm
 * feel depends on spawn-to-ready time. A Bun-compiled binary embeds a
 * pre-parsed bytecode snapshot of the whole bundle, collapsing Node's
 * interpreter + module-graph boot to single-digit milliseconds. The tsc build
 * (`pnpm --filter @langwatch/langyworker build` -> `node dist/src/main.js`)
 * remains the fallback runtime path.
 *
 * Usage:
 *   bun run scripts/build-binary.ts                                        # host platform
 *   bun run scripts/build-binary.ts --target=bun-linux-arm64 --outfile=./out/langy-worker
 */
import { rmSync } from "node:fs";
import packageJson from "../package.json" with { type: "json" };

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};

const target = flag("target");
const outfile = flag("outfile") ?? "out/langy-worker";

// `bun build --compile` refuses to overwrite a running/existing binary cleanly
// on some platforms; remove it first so repeat builds are deterministic.
rmSync(outfile, { force: true });

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
