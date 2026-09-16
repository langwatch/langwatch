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
      what: "Service class `{{name}}` must expose construction through a static create method.",
      fix: "Add a static `create` method to `{{name}}` and make its constructor private.",
    },
    missing: {
      what: "A service module must define a class whose name ends in Service.",
      fix: "Export a `*Service` class from this module.",
    },
    standalone: {
      what: "Exported function `{{name}}` in a service module.",
      fix:
        "If it only transforms its arguments, drop `export` and keep it a private module-level" +
        " helper. Otherwise move it onto the `*Service` class as a method — a service module" +
        " exports exactly one class.",
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
          if (!exported) continue;
          if (declaration.type !== "ClassDeclaration") continue;
          const className = declaration.id?.name;
          if (!className?.endsWith("Service")) continue;
          classes.push(declaration);
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
            context.report({
              node: serviceClass,
              messageId: "create",
              data: { name: serviceClass.id?.name ?? "" },
            });
          }
        }
      },
    };
  },
});
