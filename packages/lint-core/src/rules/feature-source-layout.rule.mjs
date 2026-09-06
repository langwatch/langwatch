import {
  CONTRACT_ARTIFACT,
  CONTRACT_ARTIFACT_SUFFIX,
  PROCESS_MANAGER_SERVICE_PATTERN,
  PURE_VALUE_CONSTRUCTORS,
  RULES_PATTERN,
  SERVER_ONLY_CONTRACT_ARTIFACT,
  SERVER_PATTERNS,
  isLowerKebabFilename,
} from "../../grammar/feature-layout-policy.mjs";
import { defineRule } from "../define-rule.mjs";

const SERVER_HOMES =
  "services/, ports/, repositories/, stores/, adapters/, projections/, subscribers/, " +
  "processes/, intents/, rules/, tasks/, transport/<surface>/, migrations/, app/, fixtures/";

export const featureSourceLayoutRule = defineRule({
  name: "feature-source-layout",
  kind: "problem",
  messages: {
    contractMissingSubject: {
      what: "Rename `{{name}}` to `<subject>.{{artifact}}.ts`, e.g. `agent.commands.ts`.",
      fix: "Add the subject to the filename.",
    },
    contractServerArtifact: {
      what: "Server artifact {{name}} cannot live in contract source.",
      fix: "Move it to `server/src/<dir>/`.",
    },
    contractFilename: {
      what: "Rename `{{name}}` to `<subject>.<artifact>.ts` in lower kebab case, e.g. `trace-search.service.ts`.",
      fix: "Use one of the canonical contract artifacts.",
    },
    processManagerService: {
      what: "Rename `{{path}}` to `processes/<subject>.process.ts`; a process manager is not a service.",
      fix: "Move the file to `processes/` and rename its `.service.ts` suffix to `.process.ts`.",
    },
    rulesImpurity: {
      what: "Rules module {{path}} may only export functions and constants (found {{found}}).",
      fix: "Move the class or `new` into a service or adapter and pass its result in.",
    },
    serverPath: {
      what: `\`{{path}}\` has no home in layout v0. Allowed: ${SERVER_HOMES}.`,
      fix: "Move it to the directory matching its artifact suffix.",
    },
  },
  create(context, file) {
    const source = file.strictSource;
    if (!source) return {};
    const { name, sourcePath, role } = source;

    if (role === "contract") {
      if (name === "index.ts") return {};
      const report = (messageId, data = {}) => ({
        Program(node) {
          context.report({ node, messageId, data: { name, ...data } });
        },
      });
      if (/^(?:commands|errors|events|queries|service)\.ts$/.test(name)) {
        return report("contractMissingSubject", { artifact: name.replace(/\.ts$/, "") });
      }
      if (SERVER_ONLY_CONTRACT_ARTIFACT.test(name)) return report("contractServerArtifact");
      if (
        CONTRACT_ARTIFACT_SUFFIX.test(name) &&
        !CONTRACT_ARTIFACT.test(name) &&
        isLowerKebabFilename(name)
      ) {
        return report("contractFilename");
      }
      return {};
    }

    if (role !== "server") return {};

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
          if (node.callee?.type === "Identifier" && PURE_VALUE_CONSTRUCTORS.has(node.callee.name)) {
            return;
          }
          report(node, "a `new` expression");
        },
      };
    }

    if (SERVER_PATTERNS.some((pattern) => pattern.test(sourcePath))) return {};

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
