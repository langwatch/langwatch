import { classify } from "./classify.mjs";

// The one shape a langwatch rule is written in. A message is not prose here:
// it is `what` (names the offending symbol) plus `fix` (one imperative the
// reader can apply without opening another file). `why` is documentation and
// is deliberately not part of what the linter prints.

/**
 * @typedef {object} MessageDefinition
 * @property {string} what The offence, naming the symbol or path via `{{placeholder}}`.
 * @property {string} [why] One clause of justification. Rendered in the docs, never in the message.
 * @property {string} fix One imperative sentence.
 */

/**
 * @typedef {object} OptionDefinition
 * @property {"integer" | "number" | "string" | "boolean"} type
 * @property {number} [minimum]
 * @property {unknown} [default]
 * @property {string} [description]
 */

/** `what` and `fix` joined; `why` stays out of the printed message on purpose. */
export function renderTemplate({ fix, what }) {
  return `${what.trim()} ${fix.trim()}`.trim();
}

/** Substitutes `{{name}}` from `data`, the way oxlint and ESLint do. */
export function renderMessage(template, data = {}) {
  return template.replace(/\{\{\s*([\w$]+)\s*\}\}/g, (whole, key) =>
    Object.hasOwn(data, key) ? String(data[key]) : whole,
  );
}

function schemaFor(options) {
  if (!options) return undefined;

  const properties = {};
  for (const [name, definition] of Object.entries(options)) {
    const property = { type: definition.type };
    if (definition.minimum !== undefined) property.minimum = definition.minimum;
    if (definition.description) property.description = definition.description;
    properties[name] = property;
  }

  return [{ type: "object", properties, additionalProperties: false }];
}

function defaultsFor(options) {
  const defaults = {};
  if (!options) return defaults;

  for (const [name, definition] of Object.entries(options)) {
    if (definition.default !== undefined) defaults[name] = definition.default;
  }

  return defaults;
}

/**
 * Builds the oxlint rule object from a declaration.
 *
 * `applies` gates the whole rule on the per-file classification, so a rule
 * that does not apply to a file costs one memo lookup rather than a visitor.
 *
 * @param {object} declaration
 * @param {string} declaration.name
 * @param {"problem" | "style" | "layout"} [declaration.kind]
 * @param {(file: import("./classify.mjs").FileClassification) => boolean} [declaration.applies]
 * @param {Record<string, MessageDefinition>} declaration.messages
 * @param {Record<string, OptionDefinition>} [declaration.options]
 * @param {(context: object, file: object, options: object) => object} declaration.create
 */
export function defineRule({ applies, create, kind = "problem", messages, name, options }) {
  const templates = {};
  for (const [id, definition] of Object.entries(messages)) {
    templates[id] = renderTemplate(definition);
  }

  const defaults = defaultsFor(options);
  const schema = schemaFor(options);

  const rule = {
    meta: {
      docs: { applies: applies ? applies.name || "custom" : "every file", messages, name, options },
      messages: templates,
      type: kind === "style" ? "suggestion" : kind,
    },
    create(context) {
      const file = classify(context);
      if (applies && !applies(file)) return {};

      return create(context, file, { ...defaults, ...(context.options?.[0] ?? {}) });
    },
  };

  if (schema) rule.meta.schema = schema;

  return rule;
}
