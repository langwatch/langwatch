import { defineRule } from "../define-rule.mjs";

// These names belonged to the transport shape the runtime replaced with
// `defineRestRouter` and `runtime.mount`. A reintroduction under the old name
// is a sign the wrong exemplar got copied, not a deliberate choice.

const BANNED_NAMES = new Set([
  "AppRestSecurity",
  "createAppRestSecurity",
  "SecuredApp",
  "RestApiVersionedFamily",
  "createTrpcService",
  "TrpcPolicyDecorator",
  "createServiceApp",
  "createVersionedApp",
  "createProjectVersionedApp",
  "mountProjectTransport",
  "createRestApiService",
]);

function report(context, node, name) {
  context.report({ node, messageId: "bannedLegacyName", data: { name } });
}

export const bannedLegacyNamesRule = defineRule({
  name: "banned-legacy-names",
  kind: "problem",
  messages: {
    bannedLegacyName: {
      what: "`{{name}}` was deleted.",
      fix: "Use `defineRestRouter` and `runtime.mount` instead.",
    },
  },
  create(context) {
    return {
      ImportSpecifier(node) {
        const name = node.imported.type === "Identifier" ? node.imported.name : undefined;
        if (name && BANNED_NAMES.has(name)) report(context, node, name);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && BANNED_NAMES.has(node.id.name)) {
          report(context, node, node.id.name);
        }
      },
      FunctionDeclaration(node) {
        if (node.id && BANNED_NAMES.has(node.id.name)) report(context, node, node.id.name);
      },
      ClassDeclaration(node) {
        if (node.id && BANNED_NAMES.has(node.id.name)) report(context, node, node.id.name);
      },
      TSTypeAliasDeclaration(node) {
        if (BANNED_NAMES.has(node.id.name)) report(context, node, node.id.name);
      },
      TSInterfaceDeclaration(node) {
        if (BANNED_NAMES.has(node.id.name)) report(context, node, node.id.name);
      },
    };
  },
});
