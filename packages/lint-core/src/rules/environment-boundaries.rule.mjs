import { classify } from "../classify.mjs";
import { defineRule } from "../define-rule.mjs";

// Reusable packages and application features receive typed configuration;
// only a config module or the process boot file may read the environment.

function isEnvironmentGovernedApp(workspacePath) {
  return /^apps\/(?:api|worker|ui)\/src\//.test(workspacePath);
}

function isApplicationCompositionRoot(workspacePath) {
  const configModule = /(?:^|\/)platform\/config\//.test(workspacePath);
  const processBoot = /\.(?:composition|executable|entrypoint|main|runtime)\.[cm]?tsx?$/.test(
    workspacePath,
  );
  return configModule || processBoot;
}

function isNonProductionPackageSource(workspacePath) {
  const nonProductionDirectory = /(?:^|\/)(?:__tests__|tests|__bench__|benchmarks?)(?:\/|$)/.test(
    workspacePath,
  );
  const nonProductionFilename = /\.(?:test|unit|integration|spec|bench)\.[cm]?[jt]sx?$/.test(
    workspacePath,
  );
  return nonProductionDirectory || nonProductionFilename;
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
      fix: "Parse it in `platform/config/` or a `*.composition.ts` file and pass the typed value in.",
    },
  },
  create(context, file) {
    const workspacePath = file.workspacePath;
    const reusablePackage = /^packages\/.+\/src\//.test(workspacePath);
    const processApp = isEnvironmentGovernedApp(workspacePath);
    const productionSource = !isNonProductionPackageSource(workspacePath);
    if ((!reusablePackage && !processApp) || !productionSource) return {};
    // A package may never read the environment. An app may, but only where it
    // is composing the process — that is the one place a typed value can be
    // parsed before anything downstream sees it.
    if (processApp && isApplicationCompositionRoot(workspacePath)) return {};

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
