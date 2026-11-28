import { join, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * The deploy-time replayer trusts the queue's claimed-groups index only because every call runs
 * after ops:fill-queue-tenant-claims, an order defineProjectionReplayStep forces (ADR-092).
 */

const POLICY = "projection-replay-sole-caller";
const OPERATION = "replayLane";
/** The step, and the process replayer it is handed, which only passes the call on to the engine. */
const ALLOWED = new Set([
  "packages/process/src/migration/projection-replayer.ts",
  "packages/upgrade/src/step/projection-replay-step.ts",
]);
const SCANNED = ["modules", "enterprise", "apps", "packages"];
const SOURCE_FILE = /\.[cm]?tsx?$/;
const TEST_FILE = /(\.test\.[cm]?tsx?$)|(\/__tests__\/)/;

function replayLaneCalls(file: string): number[] {
  if (!sourceText({ file }).includes(`.${OPERATION}(`)) return [];

  const source = sourceFile({ file });
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    const callee = ts.isCallExpression(node) ? node.expression : void 0;
    if (callee && ts.isPropertyAccessExpression(callee) && callee.name.text === OPERATION) {
      lines.push(source.getLineAndCharacterOfPosition(callee.name.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return lines;
}

/** Refuses a replayLane call from anywhere but defineProjectionReplayStep and its replayer. */
export function lintProjectionReplaySoleCaller(
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  const files = SCANNED.flatMap((directory) =>
    snapshot.files({
      directory: join(snapshot.root, directory),
      accept: (path) => SOURCE_FILE.test(path) && !TEST_FILE.test(path),
    }),
  );

  return files.flatMap((file) => {
    if (ALLOWED.has(relative(snapshot.root, file))) return [];

    return replayLaneCalls(file).map((line) => ({
      policy: POLICY,
      file,
      line,
      message:
        "`replayLane` is called outside defineProjectionReplayStep; that caller may run before the claimed-groups backfill, so the replay drain could stop waiting early.",
      allowed:
        "Replay a projection lane through defineProjectionReplayStep, which runs after ops:fill-queue-tenant-claims. See packages/group-queue/adrs/092-tenant-claims-index.md.",
    }));
  });
}
