import { defineRule } from "../define-rule.mjs";
import { isBrowserCode } from "../react-state.mjs";

// Text in module browser code is sized by a named product text style
// (packages/design-system/src/system/text-styles.ts), never by a pixel value.
// Mapping from every old size: dev/docs/best_practices/type-scale.md.

const SIZE_PROPS = new Set(["fontSize", "textStyle"]);
const RAW_LENGTH = /^-?\d*\.?\d+(?:px|em|rem)$/;

/** The nodes a size value can resolve through: branches, responsive objects and arrays. */
const CHILDREN = {
  ArrayExpression: (node) => node.elements,
  ConditionalExpression: (node) => [node.consequent, node.alternate],
  JSXExpressionContainer: (node) => [node.expression],
  LogicalExpression: (node) => [node.left, node.right],
  ObjectExpression: (node) =>
    node.properties.filter((property) => property.type === "Property").map((p) => p.value),
};

/** The raw value of a literal leaf, or undefined when it is a token, a name or no literal. */
function rawValueOf(node) {
  if (node.type !== "Literal") return undefined;
  if (typeof node.value === "number") return String(node.value);
  if (typeof node.value === "string" && RAW_LENGTH.test(node.value)) return node.value;
  return undefined;
}

/** Every raw literal leaf a size value can resolve to. */
function rawLeaves(node, found = []) {
  if (!node) return found;
  const value = rawValueOf(node);
  if (value !== undefined) found.push({ node, value });
  for (const child of CHILDREN[node.type]?.(node) ?? []) rawLeaves(child, found);
  return found;
}

function keyName(key) {
  if (key?.type === "Identifier" || key?.type === "JSXIdentifier") return key.name;
  if (key?.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

export const noRawFontSizeRule = defineRule({
  name: "no-raw-font-size",
  kind: "style",
  applies: isBrowserCode,
  messages: {
    rawFontSize: {
      what: "`{{prop}}` sizes text as `{{value}}`, a raw size off the product type scale.",
      why: "Ad hoc pixel sizes make related text differ by half a pixel from screen to screen.",
      fix: "Set `textStyle` to a product style (bodySm, label, caption, micro, mono…) as mapped in dev/docs/best_practices/type-scale.md; where an API takes a number, use `TYPE_SCALE_PX` from `@langwatch/design-system/typography`. See the `design-system` skill.",
    },
  },
  create(context) {
    const check = (prop, value) => {
      for (const leaf of rawLeaves(value)) {
        context.report({
          node: leaf.node,
          messageId: "rawFontSize",
          data: { prop, value: leaf.value },
        });
      }
    };

    return {
      JSXAttribute(node) {
        const prop = keyName(node.name);
        if (SIZE_PROPS.has(prop)) check(prop, node.value);
      },
      Property(node) {
        if (node.computed) return;
        const prop = keyName(node.key);
        if (SIZE_PROPS.has(prop)) check(prop, node.value);
      },
    };
  },
});
