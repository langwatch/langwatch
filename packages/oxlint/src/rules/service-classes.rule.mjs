import { defineRule } from "../define-rule.mjs";

// A strict feature service module exports exactly one class named `*Service`
// with a static `create`; anything else standalone in the module is behaviour
// that belongs on the class instead.

export const serviceClassesRule = defineRule({
  name: "service-classes",
  kind: "style",
  applies: (file) => file.isServiceModule,
  messages: {
    create: {
      what: "A service class must expose construction through a static create method.",
      fix: "Add a static `create` method and make the constructor private.",
    },
    missing: {
      what: "A service module must define a class whose name ends in Service.",
      fix: "Export a `*Service` class from this module.",
    },
    standalone: {
      what: "Exported function `{{name}}` in a service module: make it a method on the `*Service` class, or a private module-level helper (not exported).",
      fix: "Move the behaviour onto the class, or stop exporting the helper.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const classes = [];
        for (const statement of node.body) {
          let declaration = statement;
          const exported =
            statement.type === "ExportNamedDeclaration" ||
            statement.type === "ExportDefaultDeclaration";
          if (statement.type === "ExportNamedDeclaration" && statement.declaration) {
            declaration = statement.declaration;
          }
          if (statement.type === "ExportDefaultDeclaration" && statement.declaration) {
            declaration = statement.declaration;
          }
          if (exported && declaration.type === "FunctionDeclaration") {
            context.report({
              node: declaration,
              messageId: "standalone",
              data: { name: declaration.id?.name ?? "default" },
            });
          }
          if (exported && declaration.type === "VariableDeclaration") {
            for (const item of declaration.declarations) {
              if (
                item.init?.type === "ArrowFunctionExpression" ||
                item.init?.type === "FunctionExpression"
              ) {
                context.report({
                  node: item,
                  messageId: "standalone",
                  data: { name: item.id?.name ?? "" },
                });
              }
            }
          }
          if (
            exported &&
            declaration.type === "ClassDeclaration" &&
            declaration.id?.name.endsWith("Service")
          ) {
            classes.push(declaration);
          }
        }
        if (classes.length === 0) {
          context.report({ node, messageId: "missing" });
          return;
        }
        for (const serviceClass of classes) {
          const hasStaticCreate = serviceClass.body.body.some(
            (member) =>
              member.type === "MethodDefinition" &&
              member.static &&
              member.key.type === "Identifier" &&
              member.key.name === "create",
          );
          if (!hasStaticCreate) {
            context.report({ node: serviceClass, messageId: "create" });
          }
        }
      },
    };
  },
});
