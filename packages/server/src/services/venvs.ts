import { execa } from "execa";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { servicePaths } from "./paths.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

type VenvSpec = {
  name: "langwatch_nlp" | "langevals";
  projectDir: string;
  lockFile: string;
};

/**
 * Idempotent. For each python service: if the lockfile hash matches what we
 * recorded last sync, skip; otherwise run `uv sync --project <dir>` with
 * UV_PROJECT_ENVIRONMENT pointing at our managed venv path.
 */
export async function syncVenvs(ctx: RuntimeContext, bus: EventBus): Promise<void> {
  const uvBin = ctx.predeps.uv?.resolvedPath;
  if (!uvBin) throw new Error("uv predep not resolved — run install first");

  const sp = servicePaths(ctx.paths);
  const specs = resolveVenvSpecs();

  await Promise.all(
    specs.map(async (spec) => {
      const venvDir = sp.venv(spec.name);
      const hashFile = join(venvDir, ".lock-hash");
      const expected = hashFileSafely(spec.lockFile);
      if (existsSync(venvDir) && readFileSafely(hashFile) === expected) return;

      bus.emit({ type: "starting", service: `uv:${spec.name}` as never });
      const start = Date.now();

      mkdirSync(venvDir, { recursive: true });
      await execa(
        uvBin,
        ["sync", "--project", spec.projectDir],
        {
          env: {
            ...process.env,
            UV_PROJECT_ENVIRONMENT: venvDir,
          },
          stdio: "inherit",
        },
      );
      writeFileSync(hashFile, expected);
      bus.emit({ type: "healthy", service: `uv:${spec.name}` as never, durationMs: Date.now() - start });
    }),
  );
}

function resolveVenvSpecs(): VenvSpec[] {
  const root = locateMonorepoRoot();
  return [
    {
      name: "langwatch_nlp",
      projectDir: join(root, "langwatch_nlp"),
      lockFile: join(root, "langwatch_nlp", "uv.lock"),
    },
    {
      name: "langevals",
      projectDir: join(root, "langevals"),
      lockFile: join(root, "langevals", "uv.lock"),
    },
  ];
}

function locateMonorepoRoot(): string {
  // packages/server/dist/cli.cjs → ../../.. is repo root in dev,
  // node_modules/@langwatch/server/packages/server/dist/cli.cjs → ../../.. is the install root.
  const candidates = [
    join(__dirname, "..", "..", "..", ".."),
    join(__dirname, "..", "..", ".."),
    process.cwd(),
  ];
  const fallback = candidates[0];
  if (!fallback) throw new Error("monorepo root candidates list is empty (impossible)");
  return candidates.find((p) => existsSync(join(p, "langwatch_nlp", "uv.lock"))) ?? fallback;
}

function hashFileSafely(file: string): string {
  if (!existsSync(file)) return "missing";
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readFileSafely(file: string): string | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").trim();
}
