import {
  CONTRACT_ARTIFACT,
  CONTRACT_ARTIFACT_SUFFIX,
  PROCESS_MANAGER_SERVICE_PATTERN,
  PURE_VALUE_CONSTRUCTORS,
  RULES_PATTERN,
  SERVER_HOMES,
  SERVER_ONLY_CONTRACT_ARTIFACT,
  SERVER_PATTERNS,
  isLowerKebabFilename,
  isFeatureApiContract,
} from "../../grammar/feature-layout-policy.mjs";
import { defineRule } from "../define-rule.mjs";

function definitionOf(context, identifier) {
  let scope = context.sourceCode.getScope(identifier);
  while (scope && !scope.set.has(identifier.name)) scope = scope.upper;
  return scope?.set.get(identifier.name)?.defs[0];
}

function isPureThrownError(context, node) {
  if (node.parent?.type !== "ThrowStatement" || node.parent.argument !== node) return false;
  if (node.callee.type !== "Identifier") return false;

  const definition = definitionOf(context, node.callee);
  if (node.callee.name === "Error" && !definition) return true;
  if (definition?.type !== "ImportBinding") return false;

  const declaration = definition.parent;
  const imported = definition.node;
  if (declaration.importKind === "type" || imported.importKind === "type") return false;
  if (imported.type !== "ImportSpecifier") return false;
  const name = imported.imported.name ?? imported.imported.value;
  return (
    name.endsWith('Error') && /^@langwatch\/[^/]+-contract(?:\/|$)/.test(declaration.source.value)
  );
}

function contractVisitors(context, source) {
  const { name, sourcePath } = source;
  if (name === "index.ts" || isFeatureApiContract(sourcePath, source.feature)) return {};
  const report = (messageId, data = {}) => ({
    Program(node) {
      context.report({ node, messageId, data: { name, ...data } });
    },
  });
  if (/^(?:app|commands|errors|events|queries|service)\.ts$/.test(name)) {
    return report("contractMissingSubject", { artifact: name.replace(/\.ts$/, "") });
  }
  if (SERVER_ONLY_CONTRACT_ARTIFACT.test(name)) return report("contractServerArtifact");
  const malformedArtifact =
    CONTRACT_ARTIFACT_SUFFIX.test(name) &&
    !CONTRACT_ARTIFACT.test(name) &&
    isLowerKebabFilename(name);
  if (malformedArtifact) {
    return report("contractFilename");
  }
  return {};
}

export const featureSourceLayoutRule = defineRule({
  name: "feature-source-layout",
  kind: "problem",
  messages: {
    contractMissingSubject: {
      what: "Rename `{{name}}` to `<subject>.{{artifact}}.ts`, e.g. `agent.commands.ts`.",
      fix: "Add the subject to the filename.",
    },
    contractServerArtifact: {
      what: "`{{name}}` is a server artifact: contract source may not hold `.adapter`, `.api`, `.mapper`, `.migration`, `.port`, `.projection`, `.repository` or `.store` files.",
      fix:
        "Move it into `modules/<feature>/process/src/`: `.repository`, `.store` and"
        + " `.mapper` under `repositories/`, `.adapter` under `repositories/<backend>/`"
        + " or `channels/<tier>/`, `.projection` under `eventing/`, `.migration` under"
        + " `migrations/`, a `.port` rewritten as the `repositories/<subject>.repository.ts`"
        + " interface it describes, and any `.api` other than `<feature>.api.ts` as"
        + " `transport/<feature>.<rest|trpc|ws>.ts`.",
    },
    contractFilename: {
      what: "Rename `{{name}}` to `<subject>.<artifact>.ts` in lower kebab case, e.g. `trace-search.service.ts`.",
      fix:
        "Take the artifact from `app`, `commands`, `errors`, `events`, `queries` or"
        + " `service`, and write the subject and the artifact in lower kebab case with a"
        + " single dot between them.",
    },
    processManagerService: {
      what: "Rename `{{path}}` to `processes/<subject>.process.ts`; a process manager is not a service.",
      fix: "Move the file to `processes/` and rename its `.service.ts` suffix to `.process.ts`.",
    },
    rulesImpurity: {
      what: "Rules module `{{path}}` may only export functions and constants (found {{found}}).",
      fix: "Move the class or the `new` into `services/<name>.service.ts` and pass the constructed value into `{{path}}` as a function parameter.",
    },
    serverPath: {
      what: `\`{{path}}\` has no home in layout v0. Only this shape is allowed: ${SERVER_HOMES}.`,
      fix:
        "Move `{{path}}` onto one of those paths: a service flattens to"
        + " `services/<name>.service.ts`, with no subdirectory under `services/` and no"
        + " qualifier before `.service`; an adapter or store becomes"
        + " `repositories/<backend>/<backend>.<subject>.repository.ts` or"
        + " `channels/<tier>/<tier>.<subject>.channel.ts`; a projection, subscriber,"
        + " process manager or intent becomes"
        + " `eventing/<feature>.<projection|subscriber|process|intent>.ts`; a transport"
        + " becomes `transport/<feature>.<rest|trpc|ws>.ts`; a file with no artifact"
        + " suffix moves into the module that already uses it.",
    },
  },
  create(context, file) {
    const source = file.strictSource;
    if (!source) return {};
    const { sourcePath, role } = source;

    if (role === "contract") return contractVisitors(context, source);

    if (role !== "process") return {};

    if (PROCESS_MANAGER_SERVICE_PATTERN.test(sourcePath)) {
      return {
        Program(node) {
          context.report({
            node,
            messageId: "processManagerService",
            data: { path: sourcePath },
          });
        },
      };
    }

    if (RULES_PATTERN.test(sourcePath)) {
      let reported = false;
      const report = (node, found) => {
        if (reported) return;
        reported = true;
        context.report({
          node,
          messageId: "rulesImpurity",
          data: { path: sourcePath, found },
        });
      };
      return {
        ClassDeclaration(node) {
          report(node, "a class");
        },
        ClassExpression(node) {
          report(node, "a class");
        },
        NewExpression(node) {
          const pureValue =
            node.callee?.type === "Identifier" &&
            PURE_VALUE_CONSTRUCTORS.has(node.callee.name) &&
            !definitionOf(context, node.callee);
          if (pureValue || isPureThrownError(context, node)) {
            return;
          }
          report(node, "a `new` expression");
        },
      };
    }

    const hasServerHome = SERVER_PATTERNS.some((pattern) => pattern.test(sourcePath));
    if (hasServerHome) return {};

    return {
      Program(node) {
        context.report({
          node,
          messageId: "serverPath",
          data: { path: sourcePath },
        });
      },
    };
  },
});
