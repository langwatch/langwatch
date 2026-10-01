import {
  CONTRACT_ARTIFACT,
  CONTRACT_ARTIFACT_ONLY,
  CONTRACT_ARTIFACT_SUFFIX,
  PROCESS_HOMES,
  PROCESS_MANAGER_SERVICE_PATTERN,
  PROCESS_ONLY_ARTIFACT_LIST,
  PROCESS_ONLY_CONTRACT_ARTIFACT,
  PROCESS_PATTERNS,
  PURE_VALUE_CONSTRUCTORS,
  RULES_PATTERN,
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
    name.endsWith("Error") && /^@langwatch\/[^/]+-contract(?:\/|$)/.test(declaration.source.value)
  );
}

function processManagerSubject(sourcePath) {
  return sourcePath.slice(sourcePath.lastIndexOf("/") + 1).replace(/-process\.service\.ts$/, "");
}

function contractVisitors(context, source) {
  const { name, sourcePath } = source;
  if (name === "index.ts" || isFeatureApiContract(sourcePath, source.feature)) return {};
  const report = (messageId, data = {}) => ({
    Program(node) {
      context.report({ node, messageId, data: { feature: source.feature, name, ...data } });
    },
  });
  if (CONTRACT_ARTIFACT_ONLY.test(name)) {
    return report("contractMissingSubject", { artifact: name.replace(/\.ts$/, "") });
  }
  if (PROCESS_ONLY_CONTRACT_ARTIFACT.test(name)) return report("contractProcessArtifact");
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
    contractProcessArtifact: {
      what: `\`{{name}}\` is a process artifact: contract source holds none of ${PROCESS_ONLY_ARTIFACT_LIST}.`,
      fix:
        "Move it into `modules/{{feature}}/process/src/`: `.repository`, `.store` and" +
        " `.mapper` under `repositories/`, `.channel` under `channels/`, `.projection`," +
        " `.subscriber`, `.process` and `.intent` under `eventing/`, `.rules` under" +
        " `rules/`, `.task` under `tasks/`, `.migration` under `migrations/`, and any" +
        " `.api` other than `{{feature}}.api.ts` as `transport/{{feature}}.<rest|trpc|ws>.ts`.",
    },
    contractFilename: {
      what: "Rename `{{name}}` to `<subject>.<artifact>.ts` in lower kebab case, e.g. `trace-search.service.ts`.",
      fix:
        "Take the artifact from `app`, `commands`, `errors`, `events`, `queries` or" +
        " `service`, and write the subject and the artifact in lower kebab case with a" +
        " single dot between them.",
    },
    processManagerService: {
      what: "`{{path}}` is a process manager named as a service.",
      fix: "Move it to `eventing/{{subject}}.process.ts`, beside the pipeline that names it.",
    },
    rulesImpurity: {
      what: "Rules module `{{path}}` may only export functions and constants (found {{found}}).",
      fix: "Move the class or the `new` into `services/<name>.service.ts` and pass the constructed value into `{{path}}` as a function parameter.",
    },
    processPath: {
      what: `\`{{path}}\` has no home in layout v0. Only this shape is allowed: ${PROCESS_HOMES}.`,
      fix:
        "Move `{{path}}` onto one of those paths: a service flattens to" +
        " `services/<name>.service.ts`, with no subdirectory under `services/` and no" +
        " qualifier before `.service`; owned state becomes" +
        " `repositories/<backend>/<backend>.<subject>.repository.ts`, a message to" +
        " anything the module does not own becomes" +
        " `channels/<tier>/<tier>.<subject>.channel.ts`; a projection, subscriber," +
        " process manager or intent becomes" +
        " `eventing/<feature>.<projection|subscriber|process|intent>.ts`; a transport" +
        " becomes `transport/<feature>.<rest|trpc|ws>.ts`; a file with no artifact" +
        " suffix moves into the module that already uses it.",
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
            data: { path: sourcePath, subject: processManagerSubject(sourcePath) },
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

    const hasProcessHome = PROCESS_PATTERNS.some((pattern) => pattern.test(sourcePath));
    if (hasProcessHome) return {};

    return {
      Program(node) {
        context.report({
          node,
          messageId: "processPath",
          data: { path: sourcePath },
        });
      },
    };
  },
});
