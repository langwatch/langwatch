import { join, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * Only ops and identity grant, revoke or list platform operators: those operations
 * take a `system` caller that skips the ceiling and self-grant checks (ARCHITECTURE.md §7).
 */

const POLICY = "platform-operator-calls";
const AUTHZ_CONTRACT = "@langwatch/authz-contract";
const OPERATIONS = new Set([
  "grantPlatformOperator",
  "revokePlatformOperator",
  "listPlatformOperators",
]);
const ALLOWED_OWNERS = new Set(["authz", "ops", "identity"]);
const SCANNED = ["modules", "enterprise/modules", "apps", "packages"];
const SOURCE_FILE = /\.[cm]?tsx?$/;

function ownerOf({ snapshot, file }: { snapshot: WorkspaceSnapshot; file: string }): string {
  const path = relative(snapshot.root, file);
  const entry = snapshot.catalogue.find((candidate) => path.startsWith(`${candidate.root}/`));

  return entry?.id ?? "outside a module";
}

function calledOperations(file: string): { name: string; line: number }[] {
  if (!sourceText({ file }).includes(AUTHZ_CONTRACT)) return [];

  const source = sourceFile({ file });
  const found: { name: string; line: number }[] = [];
  const visit = (node: ts.Node): void => {
    const callee = ts.isCallExpression(node) ? node.expression : void 0;
    if (callee && ts.isPropertyAccessExpression(callee) && OPERATIONS.has(callee.name.text)) {
      const line = source.getLineAndCharacterOfPosition(callee.name.getStart(source)).line + 1;
      found.push({ name: callee.name.text, line });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** Refuses a call to the platform-operator operations from any owner but authz, ops, identity. */
export function lintPlatformOperatorCalls(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const files = SCANNED.flatMap((directory) =>
    snapshot.files({
      directory: join(snapshot.root, directory),
      accept: (path) => SOURCE_FILE.test(path),
    }),
  );

  return files.flatMap((file) => {
    const owner = ownerOf({ snapshot, file });
    if (ALLOWED_OWNERS.has(owner)) return [];

    return calledOperations(file).map(({ name, line }) => ({
      policy: POLICY,
      file,
      line,
      message: `\`${name}\` is called from ${owner}; a platform-operator grant skips the ceiling and self-grant checks for a \`system\` caller.`,
      allowed:
        "Only the ops and identity modules call AuthzApi.grantPlatformOperator, revokePlatformOperator and listPlatformOperators. See dev/docs/ARCHITECTURE.md §7.",
    }));
  });
}
