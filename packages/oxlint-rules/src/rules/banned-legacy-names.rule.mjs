import { defineRule } from "../define-rule.mjs";

// These names belonged to the transport shape the runtime replaced with
// `defineRestRouter` and `runtime.mount`. A reintroduction under the old name
// is a sign the wrong exemplar got copied, not a deliberate choice.

// A deleted name and the one sentence that replaces it. The sentence matters
// more than the ban: an agent told only that a name is gone reaches for the
// nearest thing it can see, which is usually the next deleted name along.
const TRANSPORT = "declare the route with `defineRestRouter` and let the process mount the declaration";

const BANNED_NAMES = new Map([
  ["AppRestSecurity", TRANSPORT],
  ["createAppRestSecurity", TRANSPORT],
  ["SecuredApp", TRANSPORT],
  ["RestApiVersionedFamily", TRANSPORT],
  ["createTrpcService", TRANSPORT],
  ["TrpcPolicyDecorator", TRANSPORT],
  ["createServiceApp", TRANSPORT],
  ["createVersionedApp", TRANSPORT],
  ["createProjectVersionedApp", TRANSPORT],
  ["mountProjectTransport", TRANSPORT],
  ["createRestApiService", TRANSPORT],
  [
    "createTestInfrastructure",
    "pass the doubles the test needs as `members` and let the rest be built from config",
  ],
  ["createTestApp", "call `createProcess({ role, config, members })` with the doubles the test needs"],
  ["persistenceFor", "install the module on its `{ live, memory }` tier"],
]);

/** Builder methods the composition no longer offers, and what to call instead. */
const BANNED_METHODS = new Map([
  ["withModule", "call `withModules([...])` once with the role's module list"],
  ["withInfrastructure", "hand the process's members to `createApp({ role, config, members })`"],
  [
    "withPersistence",
    "install the module on its tier; a store address that config never named refuses at boot rather than falling back to memory",
  ],
]);

function report(context, node, name, instead) {
  context.report({ node, messageId: "bannedLegacyName", data: { instead, name } });
}

export const bannedLegacyNamesRule = defineRule({
  name: "banned-legacy-names",
  kind: "problem",
  messages: {
    bannedLegacyName: {
      what: "`{{name}}` was deleted.",
      why: "A deleted builder left in a file is not a compile error until the file is reached, so it survives every check that runs on something else.",
      fix: "Instead, {{instead}}.",
    },
  },
  create(context) {
    return {
      ImportSpecifier(node) {
        const name = node.imported.type === "Identifier" ? node.imported.name : undefined;
        if (name && BANNED_NAMES.has(name)) report(context, node, name, BANNED_NAMES.get(name));
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && BANNED_NAMES.has(node.id.name)) {
          report(context, node, node.id.name, BANNED_NAMES.get(node.id.name));
        }
      },
      FunctionDeclaration(node) {
        if (node.id && BANNED_NAMES.has(node.id.name))
          report(context, node, node.id.name, BANNED_NAMES.get(node.id.name));
      },
      ClassDeclaration(node) {
        if (node.id && BANNED_NAMES.has(node.id.name))
          report(context, node, node.id.name, BANNED_NAMES.get(node.id.name));
      },
      TSTypeAliasDeclaration(node) {
        if (BANNED_NAMES.has(node.id.name))
          report(context, node, node.id.name, BANNED_NAMES.get(node.id.name));
      },
      TSInterfaceDeclaration(node) {
        if (BANNED_NAMES.has(node.id.name))
          report(context, node, node.id.name, BANNED_NAMES.get(node.id.name));
      },
      MemberExpression(node) {
        const name = node.property?.type === "Identifier" ? node.property.name : undefined;
        if (name && BANNED_METHODS.has(name)) report(context, node, name, BANNED_METHODS.get(name));
      },
    };
  },
});
