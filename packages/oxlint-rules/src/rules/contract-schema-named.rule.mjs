import { defineRule } from "../define-rule.mjs";

// An exported composite schema in a contract carries an interface name, so emitted
// declarations print the name instead of the whole Zod tree at every use (ADR-178).
// Why each case holds: specs/tooling/lint-contract-schema-named.feature.

const COMPOSITE_CONSTRUCTORS = new Set([
  "array",
  "discriminatedUnion",
  "intersection",
  "looseObject",
  "map",
  "object",
  "partialRecord",
  "record",
  "set",
  "strictObject",
  "tuple",
  "union",
]);
const SCHEMA_IDENTIFIER = /Schema$/;
const MODULE_PACKAGE = "@langwatch/module";

/** The innermost call of a chain like `z.object({}).strict()`, and the identifier it starts at. */
function chainRootOf(node) {
  let call;
  let current = node;
  while (current.type === "CallExpression" || current.type === "MemberExpression") {
    if (current.type === "CallExpression") {
      call = current;
      current = current.callee;
    } else current = current.object;
  }
  return current.type === "Identifier" ? { call, root: current.name } : undefined;
}

/** Whether `init` builds an object, union, collection or derived schema worth naming. */
function isCompositeSchema(init) {
  if (init.type !== "CallExpression") return false;
  const chain = chainRootOf(init);
  if (!chain?.call) return false;
  if (chain.root !== "z") return SCHEMA_IDENTIFIER.test(chain.root);
  const { callee } = chain.call;
  return (
    callee.type === "MemberExpression" &&
    callee.property.type === "Identifier" &&
    COMPOSITE_CONSTRUCTORS.has(callee.property.name)
  );
}

function interfaceNameOf(name) {
  return name[0].toUpperCase() + name.slice(1);
}

/** The edit that brings `Named` into scope, or none when the file already imports it. */
function namedImportFix(fixer, program) {
  const imports = program.body.filter((node) => node.type === "ImportDeclaration");
  const fromModule = imports.find(
    (node) =>
      node.source.value === MODULE_PACKAGE &&
      node.specifiers.length > 0 &&
      node.specifiers.every((specifier) => specifier.type === "ImportSpecifier"),
  );
  if (fromModule?.specifiers.some((specifier) => specifier.local.name === "Named")) return [];
  if (fromModule) {
    const last = fromModule.specifiers.at(-1);
    const prefix = fromModule.importKind === "type" ? "" : "type ";
    return [fixer.insertTextAfter(last, `, ${prefix}Named`)];
  }
  const line = `import type { Named } from "${MODULE_PACKAGE}";\n`;
  const lastImport = imports.at(-1);
  return lastImport
    ? [fixer.insertTextAfter(lastImport, `\n${line.trimEnd()}`)]
    : [fixer.insertTextBeforeRange([0, 0], line)];
}

/** Whether a type or import holds the interface name, or anything holds the definition's. */
function isTaken({ definition, interfaceName, program, source }) {
  if (new RegExp(`\\b${definition}\\b`).test(source)) return true;
  if (new RegExp(`\\b(?:interface|type|class|enum)\\s+${interfaceName}\\b`).test(source))
    return true;
  return program.body.some(
    (node) =>
      node.type === "ImportDeclaration" &&
      node.specifiers.some((specifier) => specifier.local.name === interfaceName),
  );
}

/** The exported const `statement` declares as an unnamed composite schema, if it does one. */
function unnamedDeclaratorOf(statement) {
  const { declaration } = statement;
  if (statement.parent?.type !== "Program" || declaration?.type !== "VariableDeclaration") return;
  if (declaration.kind !== "const" || declaration.declarations.length !== 1) return;
  const [{ id, init }] = declaration.declarations;
  if (id.type !== "Identifier" || id.typeAnnotation || !init) return;
  return isCompositeSchema(init) ? { id, init } : undefined;
}

/**
 * The schema `statement` exports unnamed, with the names its fix writes; `interfaceName` is
 * absent when every candidate is taken. A self-reference cannot be named without a cycle.
 */
function unnamedSchemaOf({ program, source, statement }) {
  const declarator = unnamedDeclaratorOf(statement);
  if (!declarator) return;
  const { id, init } = declarator;
  const initText = source.slice(init.range[0], init.range[1]);
  if (new RegExp(`\\b${id.name}\\b`).test(initText) || initText.includes("z.lazy(")) return;

  const definition = `${id.name}Definition`;
  const base = interfaceNameOf(id.name);
  const candidates = SCHEMA_IDENTIFIER.test(id.name) ? [base] : [base, `${base}Schema`];
  const interfaceName = candidates.find(
    (candidate) => !isTaken({ definition, interfaceName: candidate, program, source }),
  );
  return { definition, id, initText, interfaceName };
}

function isContractSource(file) {
  return file.role === "contract" && file.isProduction;
}

export const contractSchemaNamedRule = defineRule({
  name: "contract-schema-named",
  kind: "problem",
  fixable: "code",
  applies: isContractSource,
  messages: {
    unnamedSchema: {
      what: "The exported schema `{{name}}` has no interface name.",
      why: "Its whole Zod tree is printed into every declaration that uses it, so contracts emit huge, unstable types.",
      fix: "Run `pnpm exec oxlint --fix` on this file; it names the schema with `Named` from @langwatch/module.",
    },
  },
  create(context) {
    const source = context.sourceCode.text;
    const program = context.sourceCode.ast;
    let importFixed = false;

    return {
      ExportNamedDeclaration(statement) {
        const found = unnamedSchemaOf({ program, source, statement });
        if (!found) return;
        const { definition, id, initText, interfaceName } = found;

        context.report({
          node: id,
          messageId: "unnamedSchema",
          data: { name: id.name },
          ...(interfaceName && {
            fix: (fixer) => {
              const named = [
                `const ${definition} = ${initText};`,
                `export interface ${interfaceName} extends Named<typeof ${definition}> {}`,
                `export const ${id.name}: ${interfaceName} = ${definition};`,
              ].join("\n");
              const edits = [fixer.replaceTextRange(statement.range, named)];
              if (!importFixed) {
                importFixed = true;
                edits.push(...namedImportFix(fixer, program));
              }
              return edits;
            },
          }),
        });
      },
    };
  },
});
