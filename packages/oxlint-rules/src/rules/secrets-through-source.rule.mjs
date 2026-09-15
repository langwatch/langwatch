import registry from "@langwatch/secrets/keys.json" with { type: "json" };
import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A secret arrives through the SecretSource chain the boot seam resolves, so
// the value a feature reads has already been through classification and
// redaction. A direct `process.env.OPENAI_API_KEY` skips all of it.

const SECRET_KEYS = new Set(
  registry.keys.filter((entry) => entry.class === "secret").map((entry) => entry.key),
);

/** The package that owns the classification, and the seams that resolve it. */
function isSecretResolutionSite(workspacePath) {
  const owner = /^packages\/secrets\//.test(workspacePath);
  const configModule = /(?:^|\/)platform\/config\//.test(workspacePath);
  const processBoot =
    /\.(?:composition|executable|entrypoint|main|process|runtime)\.[cm]?tsx?$/.test(workspacePath);
  return owner || configModule || processBoot;
}

function isNonProductionSource(workspacePath) {
  const directory = /(?:^|\/)(?:__tests__|tests|e2e|__bench__|benchmarks?)(?:\/|$)/.test(
    workspacePath,
  );
  const filename = /\.(?:test|unit|integration|spec|bench)\.[cm]?[jt]sx?$/.test(workspacePath);
  return directory || filename;
}

/** The `X` in `process.env.X` and `process.env["X"]`, when it is written statically. */
export function staticPropertyName(member) {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.property.type === "Literal" && typeof member.property.value === "string") {
    return member.property.value;
  }
  return void 0;
}

export function isEnvironmentObject(node) {
  if (node.type !== "MemberExpression") return false;
  const name = staticPropertyName(node);
  if (name !== "env") return false;
  const process = node.object.type === "Identifier" && node.object.name === "process";
  return process || node.object.type === "MetaProperty";
}

export const secretsThroughSourceRule = defineRule({
  name: "secrets-through-source",
  kind: "problem",
  messages: {
    secret: {
      what: "`{{key}}` is a classified secret and is read straight from the environment here.",
      why: "A secret read directly skips classification, the source chain and log redaction.",
      fix: "Resolve it through the SecretSource chain at the boot seam and pass the typed value in.",
    },
  },
  create(context, file) {
    if (isNonProductionSource(file.workspacePath)) return {};
    if (isSecretResolutionSite(file.workspacePath)) return {};
    if (
      isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "secrets-through-source" })
    ) {
      return {};
    }

    return {
      MemberExpression(node) {
        if (!isEnvironmentObject(node.object)) return;
        const key = staticPropertyName(node);
        if (key === undefined || !SECRET_KEYS.has(key)) return;
        context.report({ node, messageId: "secret", data: { key } });
      },
    };
  },
});
