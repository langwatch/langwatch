import { statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { defineRule } from "../define-rule.mjs";

// The worker replays projections and process managers from the ordered event
// stream, so their evolution must be synchronous and deterministic; subscribers
// are delivered at-least-once, so each proves its idempotency (ARCHITECTURE §9).

const PROJECTION_FILE = /\.(?:projection|foldProjection|mapProjection)\.ts$/;
const SUBSCRIBER_FILE = /\.subscriber\.ts$/;
const PROCESS_MANAGER_FILE = /(?:^|\/)processes\/[^/]+\.process\.ts$/;
const PROCESS_SERVICE_MASQUERADE = /-process\.service\.ts$/;
const EXCLUDED_DIRECTORY = /(?:^|\/)(?:__tests__|tests|fixtures)(?:\/|$)/;
const APPLICATION_SCAN_ROOT = /^apps\/(?:api|worker)\/src\//;

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
const ROLE_LABELS = {
  process: "Process manager",
  projection: "Projection",
  subscriber: "Subscriber",
};
const IMPURE_MESSAGES = { process: "processImpure", projection: "projectionImpure" };

function roleOf(path) {
  if (PROJECTION_FILE.test(path)) return "projection";
  if (SUBSCRIBER_FILE.test(path)) return "subscriber";
  if (PROCESS_MANAGER_FILE.test(path) || PROCESS_SERVICE_MASQUERADE.test(path)) return "process";

  return undefined;
}

function isScanned(file) {
  const path = file.workspacePath;
  if (!path.endsWith(".ts") || EXCLUDED_DIRECTORY.test(path)) return false;
  if (roleOf(path) === undefined) return false;

  return (
    (file.role === "process" && file.sourcePath !== undefined) || APPLICATION_SCAN_ROOT.test(path)
  );
}

function isIoModule(specifier) {
  return (
    IO_MODULES.has(specifier) || IO_MODULE_PREFIXES.some((prefix) => specifier.startsWith(prefix))
  );
}

function calleeName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed) return callee.property.name;

  return undefined;
}

/** A method's `async` is written on the method, so the finding points there. */
function asyncDeclarationNode(node) {
  const parent = node.parent;
  const isMethod =
    parent?.type === "MethodDefinition" || (parent?.type === "Property" && parent.method);

  return isMethod ? parent : node;
}

function redeliveryTestOf(filename) {
  return join(dirname(filename), "__tests__", `${basename(filename, ".ts")}.redelivery.test.ts`);
}

function exists(path) {
  return statSync(path, { throwIfNoEntry: false }) !== undefined;
}

function purityVisitors(reportImpure) {
  const reportAsync = (node) => {
    if (node.async) reportImpure(asyncDeclarationNode(node), "declares async work");
  };

  return {
    ImportDeclaration(node) {
      const specifier = node.source.value;
      if (isIoModule(specifier)) reportImpure(node, `imports the I/O module "${specifier}"`);
    },
    AwaitExpression(node) {
      reportImpure(node, "awaits work");
    },
    FunctionDeclaration: reportAsync,
    FunctionExpression: reportAsync,
    ArrowFunctionExpression: reportAsync,
    ImportExpression(node) {
      reportImpure(node, "imports a module dynamically");
    },
  };
}

export const eventingRolePurityRule = defineRule({
  name: "eventing-role-purity",
  kind: "problem",
  applies: isScanned,
  messages: {
    projectionImpure: {
      what: "Projection {{detail}}.",
      why: "The worker refolds projections from the ordered stream; side effects or awaits make the read model depend on when it was folded.",
      fix: "Keep the fold synchronous and deterministic: return the next read-model state and let the projection store persist it; side effects belong in a subscriber.",
    },
    processImpure: {
      what: "Process manager {{detail}}.",
      why: "A process manager's evolution replays from the stream, so it must decide the same way every time.",
      fix: "Keep its evolution synchronous and deterministic, and send the owning module's command for any external or delayed work.",
    },
    durableEvent: {
      what: "{{role}} appends durable events itself with `{{name}}()`.",
      fix: "Send the owning module's command instead; only a command handler appends durable events.",
    },
    missingRedeliveryTest: {
      what: "Subscriber `{{name}}` has no redelivery test.",
      why: "Delivery is at-least-once, so every subscriber must prove a redelivered event changes nothing.",
      fix: "Add `{{expected}}` proving that handling the same event twice leaves one externally visible result; queue deduplication alone is not proof.",
    },
  },
  create(context, file) {
    const role = roleOf(file.workspacePath);
    const reported = new Set();
    const reportOnce = (messageId, where, data) => {
      if (reported.has(messageId)) return;
      reported.add(messageId);
      context.report({ ...where, messageId, data });
    };
    const impureMessage = IMPURE_MESSAGES[role];
    const reportImpure = (node, detail) => {
      if (impureMessage) reportOnce(impureMessage, { node }, { detail });
    };

    return {
      ...purityVisitors(reportImpure),
      Program() {
        if (role !== "subscriber" || file.role !== "process") return;
        const expected = redeliveryTestOf(file.filename);
        if (exists(expected)) return;

        const name = basename(file.filename);
        const shown = `${dirname(file.sourcePath)}/__tests__/${basename(expected)}`;
        const where = { loc: { line: 1, column: 0 } };
        reportOnce("missingRedeliveryTest", where, { expected: `src/${shown}`, name });
      },
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (SIDE_EFFECT_CALLS.has(name)) reportImpure(node, `calls ${name}()`);
        if (DURABLE_EVENT_CALLS.has(name)) {
          reportOnce("durableEvent", { node }, { name, role: ROLE_LABELS[role] });
        }
      },
    };
  },
});
