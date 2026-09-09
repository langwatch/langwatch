import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// Plan facts are stated once, in @langwatch/plans. One limit field in an
// object is a fixture; two or more is a plan definition, and a second plan
// definition is how two parts of the product come to quote a customer
// different numbers.

const GOVERNED = /^(?:apps\/[^/]+\/src\/|packages\/|modules\/|enterprise\/)/;
const CATALOGUE = /^packages\/plans\//;
const DECLARATION = /\.d\.[cm]?ts$/;
const GENERATED = /(?:^|\/)(?:dist|node_modules|generated)\/|\.generated\.[cm]?tsx?$/;

/** The fields that only a plan definition states. */
export const PLAN_LIMIT_FIELDS = new Set([
  "automationDailyDispatchCeiling",
  "canPublish",
  "maxMembers",
  "maxMembersLite",
  "maxMessagesPerMonth",
  "maxTriggerPersistDispatchesPerDay",
  "prices",
  "userPrice",
  "visibilityDays",
]);

/** Every file the rule governs: product source outside the catalogue itself. */
function isPlanFactSource(file) {
  const path = file.workspacePath;
  if (!GOVERNED.test(path)) return false;
  if (CATALOGUE.test(path)) return false;
  if (DECLARATION.test(path)) return false;
  if (GENERATED.test(path)) return false;

  return file.isProduction;
}

function propertyName(property) {
  if (property.type !== "Property" || property.computed) return undefined;
  const key = property.key;
  if (key?.type === "Identifier") return key.name;
  if (key?.type === "Literal" && typeof key.value === "string") return key.value;

  return undefined;
}

/** The limit fields this object literal states, in source order. */
function statedFields(node) {
  const found = [];
  for (const property of node.properties ?? []) {
    const name = propertyName(property);
    if (name && PLAN_LIMIT_FIELDS.has(name)) found.push(name);
  }

  return found;
}

/** What the reader sees beside the literal, so the message names it. */
function declaredName(node) {
  let current = node.parent;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current.type === "VariableDeclarator" && current.id?.type === "Identifier") {
      return `\`${current.id.name}\``;
    }
    if (current.type === "Property" && current.key?.type === "Identifier") {
      return `\`${current.key.name}\``;
    }
    current = current.parent;
  }

  return "This object literal";
}

export const planLiteralsRule = defineRule({
  name: "plan-literals",
  kind: "problem",
  applies: isPlanFactSource,
  messages: {
    statesPlanFacts: {
      what: "{{name}} states {{fields}} itself.",
      why: "An object assigning two or more limit fields is a plan definition, and there is one catalogue of those.",
      fix: 'Read them from the catalogue: `planCatalogue.plan("<TYPE>").limits` from @langwatch/plans. If this is a fixture, build it from `planCatalogue.plan(...)` and override the one field the test is about.',
    },
  },
  create(context, file) {
    if (isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "plan-literals" })) {
      return {};
    }

    return {
      ObjectExpression(node) {
        const fields = statedFields(node);
        if (fields.length < 2) return;

        context.report({
          node,
          messageId: "statesPlanFacts",
          data: {
            fields: fields.map((field) => `\`${field}\``).join(", "),
            name: declaredName(node),
          },
        });
      },
    };
  },
});
