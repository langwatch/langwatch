import { defineRule } from "../define-rule.mjs";

// Config is drilled, never ambient: one parse per process, in the app's
// `main.ts`/`config.ts`, and `@langwatch/secrets` resolves the classified keys.
// `apps/server` is the published npx CLI, whose configuration surface is the environment.

const GOVERNED_SOURCE = /^(?:(?:packages|modules|enterprise)\/.+|apps\/(?!server\/)[^/]+)\/src\//;
const PROCESS_BOOT = /^apps\/[^/]+\/src\/(?:main|config)\.[cm]?tsx?$/;
const SECRETS_PACKAGE = /^packages\/secrets\//;
const BENCHMARK = /(?:^|\/)(?:__bench__|benchmarks?)(?:\/|$)|\.bench\.[cm]?[jt]sx?$/;

function readsEnvironmentLegitimately(file) {
  const path = file.workspacePath;
  return (
    !GOVERNED_SOURCE.test(path) ||
    PROCESS_BOOT.test(path) ||
    SECRETS_PACKAGE.test(path) ||
    file.isTest ||
    BENCHMARK.test(path)
  );
}

/**
 * This is a direct-syntax guard, not taint analysis: it catches canonical
 * process/import-meta environment spellings, including static computed keys,
 * but deliberately does not follow aliases or global-object indirection.
 */
function staticMemberPropertyName(member) {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  return staticComputedPropertyName(member.property);
}

function staticComputedPropertyName(property) {
  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  if (property.type === "TemplateLiteral" && property.expressions.length === 0) {
    return property.quasis[0]?.value.cooked ?? void 0;
  }
  if (property.type === "BinaryExpression" && property.operator === "+") {
    const left = staticComputedPropertyName(property.left);
    const right = staticComputedPropertyName(property.right);
    return left === undefined || right === undefined ? void 0 : `${left}${right}`;
  }
  return void 0;
}

export const environmentBoundariesRule = defineRule({
  name: "environment-boundaries",
  kind: "problem",
  messages: {
    environment: {
      what: "Do not read `process.env` here.",
      fix: "Declare the key in the module's config schema and take the parsed value as an argument; only an app's `src/main.ts` or `src/config.ts` reads the environment.",
    },
  },
  applies: (file) => !readsEnvironmentLegitimately(file),
  create(context) {
    return {
      MemberExpression(node) {
        const propertyName = staticMemberPropertyName(node);
        const isProcessEnv =
          node.object.type === "Identifier" &&
          node.object.name === "process" &&
          propertyName === "env";
        const isImportMetaEnv = node.object.type === "MetaProperty" && propertyName === "env";
        if (isProcessEnv || isImportMetaEnv) {
          context.report({ node, messageId: "environment" });
        }
      },
    };
  },
});
