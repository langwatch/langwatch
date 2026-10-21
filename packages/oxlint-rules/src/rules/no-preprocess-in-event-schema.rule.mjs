import { defineRule } from "../define-rule.mjs";

// A payload schema must not rewrite its input with `z.preprocess`: a changed shape is a new event
// version read through an upcast. Name-based, so it leans to false negatives (ADR 182).
// See dev/docs/adr/182-platform-blocks-architecture-drift.md.

const EVENT_FILE = /\.events\.[cm]?tsx?$/;
const PAYLOAD_SCHEMA_NAME = /(?:Payload|EventData)Schema(?:Definition)?$/;
const ZOD_MODULE = /^zod(?:\/|$)/;
const GOVERNED_ROLES = new Set(["contract", "process"]);

function isZodImport(statement) {
  return statement.type === "ImportDeclaration" && ZOD_MODULE.test(String(statement.source.value));
}

/** Sorts one zod import specifier into the namespace or direct-binding set. */
function recordSpecifier({ specifier, namespaces, direct }) {
  if (specifier.type !== "ImportSpecifier") {
    namespaces.add(specifier.local.name);
    return;
  }
  const imported = specifier.imported?.name ?? specifier.imported?.value;
  if (imported === "z") namespaces.add(specifier.local.name);
  if (imported === "preprocess") direct.add(specifier.local.name);
}

/** The names a file reaches preprocess through: zod namespaces and direct bindings. */
function zodBindingsOf(program) {
  const namespaces = new Set();
  const direct = new Set();
  for (const statement of program.body.filter(isZodImport)) {
    for (const specifier of statement.specifiers ?? []) {
      recordSpecifier({ specifier, namespaces, direct });
    }
  }
  // A file that writes `z.preprocess` through a re-exported `z` still counts.
  if (namespaces.size === 0) namespaces.add("z");

  return { direct, namespaces };
}

function isPreprocessCall(node, { direct, namespaces }) {
  const callee = node.callee;
  if (callee.type === "Identifier") return direct.has(callee.name);

  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.name === "preprocess" &&
    callee.object.type === "Identifier" &&
    namespaces.has(callee.object.name)
  );
}

function nameOf(node) {
  if (node.type === "VariableDeclarator" && node.id.type === "Identifier") return node.id.name;
  if ((node.type === "Property" || node.type === "PropertyDefinition") && !node.computed) {
    return node.key?.name ?? node.key?.value;
  }

  return undefined;
}

/** Whether any const or property enclosing `node` is named for a payload schema. */
function insidePayloadSchema(node) {
  for (let current = node.parent; current; current = current.parent) {
    const name = nameOf(current);
    if (typeof name === "string" && PAYLOAD_SCHEMA_NAME.test(name)) return true;
  }

  return false;
}

export const noPreprocessInEventSchemaRule = defineRule({
  name: "no-preprocess-in-event-schema",
  kind: "problem",
  applies: (file) => file.isProduction && GOVERNED_ROLES.has(file.role),
  messages: {
    preprocessInEventSchema: {
      what: "`z.preprocess` rewrites the input of an event payload schema.",
      why: "A stored payload keeps its shape forever, so reshaping it inside one schema hides a second version.",
      fix: "Version the event and add an upcast (`withUpcasts`) that reads the stored version as the current one. Read the `eventing-and-worker` skill.",
    },
  },
  create(context, file) {
    const inEventFile = EVENT_FILE.test(file.workspacePath);
    let bindings = { direct: new Set(), namespaces: new Set(["z"]) };

    return {
      Program(node) {
        bindings = zodBindingsOf(node);
      },
      CallExpression(node) {
        if (!isPreprocessCall(node, bindings)) return;
        if (inEventFile || insidePayloadSchema(node)) {
          context.report({ node, messageId: "preprocessInEventSchema" });
        }
      },
    };
  },
});
