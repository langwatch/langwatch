import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const PROJECTION_FILE = /\.(?:projection|foldProjection|mapProjection)\.ts$/;
const SUBSCRIBER_FILE = /\.subscriber\.ts$/;
// A process manager lives at `processes/<subject>.process.ts` (the grammar's
// kind) or masquerades as `-process.service.ts`. A bare `*.process.ts` file
// outside `processes/` is an OS process entry (`apps/api/src/api.process.ts`,
// `apps/worker/src/worker.process.ts`), not a process manager, and is not
// scanned for eventing purity.
const PROCESS_MANAGER_FILE = /(?:^|\/)processes\/[^/]+\.process\.ts$/;
const PROCESS_SERVICE_MASQUERADE = /-process\.service\.ts$/;

const IO_MODULES = new Set([
  "axios",
  "got",
  "node:child_process",
  "node:cluster",
  "node:dgram",
  "node:dns",
  "node:fs",
  "node:http",
  "node:http2",
  "node:https",
  "node:net",
  "node:readline",
  "node:tls",
  "node:worker_threads",
  "undici",
]);
const IO_MODULE_PREFIXES = ["@anthropic-ai/", "@aws-sdk/", "node:fs/", "node:dns/", "openai/"];
const SIDE_EFFECT_CALLS = new Set([
  "fetch",
  "queueMicrotask",
  "setImmediate",
  "setInterval",
  "setTimeout",
]);
const DURABLE_EVENT_CALLS = new Set([
  "appendEvents",
  "appendToStream",
  "createEvent",
  "saveEvents",
  "storeEvents",
]);

type EventingRole = "process" | "projection" | "subscriber";

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function roleOf(file: string): EventingRole | null {
  if (PROJECTION_FILE.test(file)) return "projection";
  if (SUBSCRIBER_FILE.test(file)) return "subscriber";
  if (PROCESS_MANAGER_FILE.test(file) || PROCESS_SERVICE_MASQUERADE.test(file))
    return "process";
  return null;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function callName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) || ts.isPropertyAccessChain(expression)) {
    return expression.name.text;
  }
  return null;
}

function isIoModule(specifier: string): boolean {
  return (
    IO_MODULES.has(specifier) || IO_MODULE_PREFIXES.some((prefix) => specifier.startsWith(prefix))
  );
}

function lintRoleFile(file: string, role: EventingRole): ArchitectureViolation[] {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: ArchitectureViolation[] = [];
  const seen = new Set<string>();

  const add = (policy: string, node: ts.Node, message: string, allowed: string): void => {
    const line = lineOf(sourceFile, node);
    const key = policy;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ policy, file, line, message, allowed });
  };

  const visit = (node: ts.Node): void => {
    const isPurityRole = role === "projection" || role === "process";
    const isIoImport =
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isIoModule(node.moduleSpecifier.text);
    if (isIoImport && isPurityRole) {
      add(
        `eventing-${role}-purity`,
        node,
        `${role === "projection" ? "Projection" : "Process definition"} source cannot import I/O module ${JSON.stringify(node.moduleSpecifier.text)}.`,
        role === "projection"
          ? "Return a deterministic projection write and let the projection store perform persistence."
          : "Keep evolution in the process definition and move external work into a retry-safe intent executor.",
      );
    }

    if (ts.isAwaitExpression(node) && (role === "projection" || role === "process")) {
      add(
        `eventing-${role}-purity`,
        node,
        `${role === "projection" ? "Projection" : "Process definition"} source cannot await work.`,
        role === "projection"
          ? "Keep projection evolution synchronous; the Eventing executor owns store I/O."
          : "Keep process evolution synchronous and emit a durable intent for external work.",
      );
    }

    const isFunctionDeclaration = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node);
    const isCallableDeclaration = ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
    const isAsyncDeclaration =
      (isFunctionDeclaration || isCallableDeclaration) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
    if (isAsyncDeclaration && isPurityRole) {
      add(
        `eventing-${role}-purity`,
        node,
        `${role === "projection" ? "Projection" : "Process definition"} source cannot declare async work.`,
        role === "projection"
          ? "Keep projection evolution synchronous; the Eventing executor owns store I/O."
          : "Move the async operation into src/intents/<subject>.intent.ts and register it by dependency.",
      );
    }

    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (name && SIDE_EFFECT_CALLS.has(name) && isPurityRole) {
        add(
          `eventing-${role}-purity`,
          node,
          `${role === "projection" ? "Projection" : "Process definition"} source cannot call ${name}().`,
          role === "projection"
            ? "Keep projection evolution deterministic and bounded."
            : "Represent delayed or external work as a durable wake or intent.",
        );
      }
      if (name && DURABLE_EVENT_CALLS.has(name)) {
        add(
          "eventing-durable-event-path",
          node,
          `${role[0]!.toUpperCase()}${role.slice(1)} source cannot fabricate or append durable events with ${name}().`,
          role === "process"
            ? "Emit a deterministic process intent whose executor invokes the owning feature command."
            : "Invoke the owning feature command/pipeline; only command handlers append new durable events.",
        );
      }
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        (role === "projection" || role === "process")
      ) {
        add(
          `eventing-${role}-purity`,
          node,
          `${role === "projection" ? "Projection" : "Process definition"} source cannot dynamically import dependencies.`,
          "Resolve dependencies at composition time and inject the narrow role contract.",
        );
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/**
 * Beside the subscriber, in its `__tests__` directory.
 *
 * This used to look in `<pkg>/tests/subscribers/`, and went on looking there
 * after `5f9acf2b79` moved every feature package's tests next to the code they
 * cover. Twenty of the twenty-two subscribers it reported had a redelivery test
 * the whole time, in `src/subscribers/__tests__/` — the location
 * `feature-layout.ts` names as the one a test may occupy. A rule that reports a
 * test as missing while reading it is worse than no rule: it costs the reader
 * the same attention as a real finding and teaches them the policy is noise.
 *
 * No package uses the old path any more, so this checks one location rather
 * than accepting both. A redelivery test somewhere else in the package still
 * counts as absent, which is the point — the pairing has to be visible from the
 * subscriber's own directory.
 */
function subscriberRedeliveryTest(file: string): string {
  const subject = basename(file, ".ts");
  return join(dirname(file), "__tests__", `${subject}.redelivery.test.ts`);
}

function lintStrictSubscriberTest(file: string, pkg: ClassifiedPackage): ArchitectureViolation[] {
  const expected = subscriberRedeliveryTest(file);
  if (existsSync(expected)) return [];
  return [
    {
      policy: "eventing-subscriber-idempotency",
      file,
      message: `Strict-package subscriber ${JSON.stringify(basename(file))} has no named redelivery contract test.`,
      allowed: `Add ${workspacePath(pkg.root, expected)} and prove that handling the same source event twice leaves one externally visible result. Queue deduplication alone is not sufficient.`,
    },
  ];
}

export function lintEventingRoles(
  root: string,
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const scanRoots = [
    join(root, "apps/api/src"),
    join(root, "apps/worker/src"),
    join(root, "packages/enterprise/composition/api/src"),
    join(root, "packages/enterprise/composition/worker/src"),
  ];
  for (const pkg of packages) {
    if (pkg.kind === "server") scanRoots.push(join(pkg.root, "src"));
  }

  const packageByFile = packages
    .filter((pkg) => pkg.kind === "server")
    .sort((left, right) => right.root.length - left.root.length);

  for (const scanRoot of new Set(scanRoots)) {
    for (const file of walkFiles(scanRoot, (candidate) => candidate.endsWith(".ts"))) {
      if (/(?:^|\/)(?:__tests__|tests|fixtures)(?:\/|$)/.test(file)) continue;
      const role = roleOf(file);
      if (!role) continue;
      violations.push(...lintRoleFile(file, role));
      if (role !== "subscriber") continue;
      const pkg = packageByFile.find(
        (candidate) => file === candidate.root || file.startsWith(`${candidate.root}${sep}`),
      );
      if (pkg?.layoutVersion === 0) {
        violations.push(...lintStrictSubscriberTest(file, pkg));
      }
    }
  }
  return violations;
}
