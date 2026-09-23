import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import ts from "typescript";

import type { ClassifiedPackage, FeatureCatalogueEntry } from "../src/types.ts";
import { scriptKind } from "../src/workspace/module-graph.ts";
import { buildWorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import type { WorkspaceSnapshot } from "../src/workspace/snapshot.ts";

/**
 * A snapshot of a fixture tree. The walk, the resolver and the parse cache are
 * the real ones; `packages` and `catalogue` are overridable so a test can hand
 * a policy the classification it means to exercise.
 */
export function snapshotOf({
  root,
  packages,
  catalogue,
  changedFiles = [],
}: {
  root: string;
  packages?: readonly ClassifiedPackage[];
  catalogue?: readonly FeatureCatalogueEntry[];
  changedFiles?: readonly string[];
}): WorkspaceSnapshot {
  const snapshot = buildWorkspaceSnapshot({ root, changedFiles });

  return {
    ...snapshot,
    packages: packages ?? snapshot.packages,
    catalogue: catalogue ?? snapshot.catalogue,
  };
}

/**
 * A syntax tree for source a test supplies inline. Production parses through
 * the shared cache, which reads the file it is named after; a fixture that
 * exists only as a string is parsed here instead.
 */
export function parsedSource(name: string, text: string): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, scriptKind(name));
}

/** Every file a policy refuses to run without; a fixture that runs the registry writes them. */
export const POLICY_ANCHORS: Readonly<Record<string, string>> = {
  "packages/prisma-client/prisma/schema.prisma": "",
  "packages/clickhouse-migrations/migrations/.keep": "",
  "packages/installed-server-modules/src/server-modules.generated.ts":
    "export const serverModules = [\n] as const;\n",
  "dev/tsconfig.declarations.json": '{ "files": [], "references": [] }\n',
  "apps/api/src/main.ts": "",
  "apps/worker/src/main.ts": "",
  "apps/tasks/src/main.ts": "",
  "apps/server/src/cli.ts": "",
  "packages/scenario-child/src/scenario-child.entrypoint.ts": "",
};

/** Writes each anchor that is not already there, so a fixture's own copy wins. */
export function writePolicyAnchors(root: string): void {
  for (const [file, text] of Object.entries(POLICY_ANCHORS)) {
    const path = join(root, file);
    if (existsSync(path)) continue;

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}
