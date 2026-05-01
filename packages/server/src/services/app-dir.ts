import { execa } from "execa";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "../shared/paths.ts";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Where the @langwatch/server tree was unpacked or checked out — used as
 * the COPY SOURCE for ensureAppDir. After bundling, packages/server/dist/
 * cli.cjs lives 3 levels under the package root in both layouts:
 *   - dev workspace:   <repo>/packages/server/dist/cli.cjs
 *   - published tarball: node_modules/@langwatch/server/packages/server/dist/cli.cjs
 * So `dirname(cli.cjs)/../../..` == package root in both.
 */
function locatePackageSource(): string | null {
  const candidate = join(__dirname, "..", "..", "..");
  if (existsSync(join(candidate, "langwatch", "package.json"))) {
    return candidate;
  }
  return null;
}

function isUnderNodeModules(p: string): boolean {
  return p.split(/[\\/]/).includes("node_modules");
}

/**
 * Relocate the @langwatch/server tree out of node_modules into LANGWATCH_HOME/app/.
 *
 * Why: tsx 4.x's CJS resolveTsPaths skips the tsconfig-paths matcher when
 * the *requesting* file's path includes "/node_modules/" (intentional guard
 * against transpiling third-party deps). Because npx caches @langwatch/server
 * under a node_modules tree, every file in the langwatch app inherits that
 * skip — `~/server/app-layer/...` imports never get aliased and the app
 * dies on the first `pnpm clickhouse:migrate` boot. Moving the tree to
 * ~/.langwatch/app/ takes the source out of any node_modules ancestry.
 *
 * Copies langwatch/, langwatch_nlp/, langevals/, python-sdk/, services/,
 * etc. as siblings — preserves the relative `editable+../python-sdk`
 * references that langwatch_nlp's pyproject and langevals/ts-integration's
 * generators rely on.
 *
 * Skips node_modules subtrees: those are reinstalled by ensureLangwatchDeps
 * directly in the relocated dir. Idempotent via a .installed-version
 * marker — same version → no-op.
 */
export async function ensureAppDir(ctx: RuntimeContext, bus: EventBus): Promise<void> {
  const src = locatePackageSource();
  if (!src) throw new Error("could not locate @langwatch/server package source");

  // Dev mode: source is checked out at a regular path (no node_modules
  // ancestor). The tsx guard doesn't fire and editing in-place is part of
  // the dev loop — relocating would break that. appRoot() handles this
  // case by returning the source path directly.
  if (!isUnderNodeModules(src)) return;

  const dst = ctx.paths.app;
  const versionMarker = join(dst, ".installed-version");

  if (existsSync(versionMarker)) {
    const installed = readFileSync(versionMarker, "utf8").trim();
    if (installed === ctx.version) return;
  }

  bus.emit({ type: "starting", service: "prepare:app" as never });
  const start = Date.now();

  mkdirSync(dst, { recursive: true });

  // Prefer rsync — handles --exclude for node_modules and --delete for
  // version upgrades in one pass. Falls back to a tar pipe (universally
  // available) if rsync is missing on the host.
  const rsyncProbe = await execa("which", ["rsync"], { reject: false });
  if (rsyncProbe.exitCode === 0) {
    await execa(
      "rsync",
      [
        "-a",
        "--delete",
        "--exclude=node_modules",
        "--exclude=.installed-version",
        "--exclude=.git",
        `${src}/`,
        `${dst}/`,
      ],
      { stdio: "pipe" },
    );
  } else {
    // tar | tar avoids cp -R's quirks across BSD vs GNU and gives us
    // exclude support. Stream so memory stays flat for large trees.
    await execa("sh", ["-c", `tar -cf - --exclude=node_modules --exclude=.git -C "${src}" . | tar -xf - -C "${dst}"`]);
  }

  writeFileSync(versionMarker, ctx.version);
  bus.emit({ type: "healthy", service: "prepare:app" as never, durationMs: Date.now() - start });
}

/**
 * Resolves a path inside the relocated app tree. Falls back to the dev
 * workspace location if the relocation hasn't run yet (e.g. CLI commands
 * that don't go through installServices).
 */
export function appRoot(): string {
  // Prefer the relocated tree when ensureAppDir has actually relocated
  // (i.e. there's a version marker). Otherwise fall back to the source —
  // either dev mode (no relocation needed) or pre-relocation lookup
  // during the install phase itself.
  if (existsSync(join(paths.app, ".installed-version"))) {
    return paths.app;
  }
  const src = locatePackageSource();
  if (!src) throw new Error("@langwatch/server tree not found (neither relocated nor in source layout)");
  return src;
}
