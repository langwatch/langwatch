import { defineRule } from "../define-rule.mjs";

// Reading a credential off a request is the door's job (api-framework-bypass plan, guard 1).

const READER =
  /^(?:\w+CredentialOfRequest|browserCallerOfRequest|principalOfCredential|extractBearer\w*)$/;
export const CREDENTIAL_OWNERS = ["packages/api/", "packages/process/", "modules/auth/"];

function nameOf(node) {
  return node?.type === "Identifier" ? node.name : undefined;
}

export const credentialReaderOwnerRule = defineRule({
  name: "credential-reader-owner",
  kind: "problem",
  applies: (file) =>
    file.isProduction && !CREDENTIAL_OWNERS.some((owner) => file.workspacePath.startsWith(owner)),
  escape: { framework: "the `@langwatch/api` door (`.withPermission`, `.withAccess`)" },
  messages: {
    credentialReader: {
      what: "`{{name}}` reads a credential off the request in `{{path}}`.",
      why: "Only the door resolves a credential; a module reading one rebuilds authentication beside it.",
      fix: "Declare the route's access with `.withPermission(...)` or `.withAccess(...)` and read `actor` and `scope` from the handler. Read the `api-transports` skill.",
    },
  },
  create(context, file) {
    const report = (node, name) =>
      context.report({
        node,
        messageId: "credentialReader",
        data: { name, path: file.workspacePath },
      });

    const namespaces = new Set();

    return {
      ImportNamespaceSpecifier(node) {
        namespaces.add(node.local.name);
      },
      MemberExpression(node) {
        if (node.computed || !namespaces.has(nameOf(node.object))) return;
        const name = nameOf(node.property);
        if (READER.test(name ?? "")) report(node, name);
      },
      ImportSpecifier(node) {
        const name = nameOf(node.imported) ?? node.imported?.value;
        if (READER.test(name ?? "")) report(node, name);
      },
      FunctionDeclaration(node) {
        const name = nameOf(node.id);
        if (READER.test(name ?? "")) report(node, name);
      },
      VariableDeclarator(node) {
        const name = nameOf(node.id);
        if (READER.test(name ?? "")) report(node, name);
      },
    };
  },
});
