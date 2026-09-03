import { execa } from "execa";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { resolvePnpm } from "./node-deps.ts";

// The `langwatch` CLI is the assistant's ONLY interface to LangWatch, every
// skill is written against its command grammar, and a worker with no CLI can
// answer from the model alone but cannot look anything up. Pinned rather than
// tracking latest so the grammar the skills were written against is the
// grammar that gets installed; bump in lockstep with a tested release, the
// same rule Dockerfile.langyagent follows for the container image.
export const LANGY_CLI_VERSION = "1.0.0";

/**
 * Puts a `langwatch` executable on the PATH the assistant's workers inherit.
 *
 * Installed from npm rather than shipped in the server tarball: it is 4MB that
 * only an install running the assistant needs, and fetching it here keeps it
 * out of every install that does not.
 *
 * Idempotent, a marker file records the version installed, so re-running the
 * server is a no-op until the pin moves.
 */
export async function ensureLangyCli(ctx: RuntimeContext, bus: EventBus): Promise<void> {
  const cliRoot = join(ctx.paths.root, "cli");
  const marker = join(cliRoot, ".installed-version");
  const shim = join(ctx.paths.bin, "langwatch");
  const entry = join(cliRoot, "node_modules", "langwatch", "dist", "cli", "index.js");

  // The entrypoint is part of the fast-path condition: a pruned or
  // half-deleted cli/node_modules with the marker still present would
  // otherwise leave a shim pointing at nothing until the pin next moved.
  if (
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === LANGY_CLI_VERSION &&
    existsSync(shim) &&
    existsSync(entry)
  ) {
    return;
  }

  bus.emit({ type: "starting", service: "prepare:langy-cli" as never });
  const start = Date.now();

  mkdirSync(cliRoot, { recursive: true });
  // A bare package.json keeps pnpm from walking up into ~/.langwatch/app and
  // resolving against the LangWatch workspace.
  writeFileSync(
    join(cliRoot, "package.json"),
    JSON.stringify({ name: "langwatch-cli-host", private: true, version: "0.0.0" }, null, 2) + "\n",
  );

  const pnpm = await resolvePnpm(ctx.paths);
  await execa(pnpm.command, [...pnpm.args, "add", `langwatch@${LANGY_CLI_VERSION}`], {
    cwd: cliRoot,
    stdio: "pipe",
  });

  if (!existsSync(entry)) {
    throw new Error(`langwatch CLI ${LANGY_CLI_VERSION} installed but ${entry} is missing`);
  }

  // A shell shim rather than a symlink into node_modules/.bin: the workers get
  // a PATH, not a package manager, and the shim keeps the resolved entrypoint
  // readable when someone goes looking for what the assistant just ran.
  // Paths are single-quoted (with embedded quotes escaped) because they derive
  // from LANGWATCH_HOME: inside double quotes the shell would expand a $ or a
  // backtick that the directory name happens to contain.
  mkdirSync(ctx.paths.bin, { recursive: true });
  const sq = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;
  writeFileSync(shim, `#!/bin/sh\nexec ${sq(process.execPath)} ${sq(entry)} "$@"\n`, {
    mode: 0o755,
  });
  chmodSync(shim, 0o755);
  writeFileSync(marker, LANGY_CLI_VERSION);

  bus.emit({
    type: "healthy",
    service: "prepare:langy-cli" as never,
    durationMs: Date.now() - start,
  });
}
