import { defineRule } from "../define-rule.mjs";

// Whether an ingestion source takes events is decided once, in the governance
// contract's source-health.ts. A second spelling drifts: the push door once
// checked only `archivedAt` while pull checked `status`, so a disabled source
// kept ingesting (GOV-01). Anomaly rules have their own status and stay out.

const LIVENESS_FILE = /\/features\/ingestion\/source-health\.ts$/;
const ANOMALY = /anomaly/i;
const SOURCE_STATES = new Set(["disabled", "awaiting_first_event"]);
const EQUALITY = new Set(["===", "!==", "==", "!="]);

function governsLiveness(file) {
  const path = file.workspacePath;

  return (
    file.isProduction &&
    file.moduleEnterprise &&
    file.module === "governance" &&
    !LIVENESS_FILE.test(path) &&
    !ANOMALY.test(path)
  );
}

/** `status`, `<anything>.status` or `<anything>["status"]`. */
function isStatusOperand(node) {
  if (node?.type === "Identifier") return node.name === "status";
  if (node?.type !== "MemberExpression") return false;
  if (node.computed) return node.property?.type === "Literal" && node.property.value === "status";

  return node.property?.type === "Identifier" && node.property.name === "status";
}

function sourceStateOf(node) {
  return node?.type === "Literal" && SOURCE_STATES.has(node.value) ? node.value : undefined;
}

export const ingestionSourceStatusLiteralRule = defineRule({
  name: "ingestion-source-status-literal",
  kind: "problem",
  applies: governsLiveness,
  messages: {
    statusLiteral: {
      what: 'A source `status` is compared with "{{state}}" in `{{path}}`.',
      why: "Whether a source takes events is decided once; a second spelling drifts and lets a disabled source ingest.",
      fix: "Call `ingestionSourceIsLive(source)` or `ingestionSourceStatusIsOff(status)` from `@langwatch/enterprise-governance-contract`. Read the `contract` skill.",
    },
  },
  create(context, file) {
    return {
      BinaryExpression(node) {
        if (!EQUALITY.has(node.operator)) return;

        const state =
          (isStatusOperand(node.left) && sourceStateOf(node.right)) ||
          (isStatusOperand(node.right) && sourceStateOf(node.left));
        if (!state) return;

        context.report({
          node,
          messageId: "statusLiteral",
          data: { state, path: file.workspacePath },
        });
      },
    };
  },
});
