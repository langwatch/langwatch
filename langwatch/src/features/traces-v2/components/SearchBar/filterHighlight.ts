import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import {
  parse as liqeParse,
  type LiqeQuery,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
  type TagToken,
  type UnaryOperatorToken,
} from "liqe";
import { SCENARIO_FIELDS } from "../../utils/queryParser";

// Tolerant fallback for queries that don't yet parse (mid-typing, unmatched
// quotes, trailing operator). Decorates anything shaped like `field:value`
// so users still get visual feedback while editing.
const FILTER_TOKEN_REGEX =
  /(?<prefix>NOT\s+|-)?(?<field>[a-zA-Z][a-zA-Z0-9_.]*):(?:"[^"]*"|\[[^\]]*\]|[^\s()]+)/g;

export interface DecorationSlot {
  from: number;
  to: number;
  className: string;
}

function tagClassName({
  fieldName,
  negated,
}: {
  fieldName: string;
  negated: boolean;
}): string {
  if (negated) return "filter-token filter-token-exclude";
  if (SCENARIO_FIELDS.has(fieldName)) return "filter-token filter-token-scenario";
  return "filter-token";
}

function walkAst(
  node: LiqeQuery,
  negated: boolean,
  baseOffset: number,
  out: DecorationSlot[],
): void {
  switch (node.type) {
    case "Tag": {
      const tag = node as TagToken;
      if (tag.field.type === "ImplicitField") return; // free text — no decoration
      out.push({
        from: baseOffset + tag.location.start,
        to: baseOffset + tag.location.end,
        className: tagClassName({ fieldName: tag.field.name, negated }),
      });
      return;
    }
    case "UnaryOperator": {
      const unary = node as UnaryOperatorToken;
      const isNeg = unary.operator === "NOT" || unary.operator === "-";
      const kwLen = unary.operator === "NOT" ? 3 : 1;
      out.push({
        from: baseOffset + unary.location.start,
        to: baseOffset + unary.location.start + kwLen,
        className: "filter-keyword filter-keyword-not",
      });
      walkAst(unary.operand, negated !== isNeg, baseOffset, out);
      return;
    }
    case "LogicalExpression": {
      const logic = node as LogicalExpressionToken;
      walkAst(logic.left, negated, baseOffset, out);
      if (logic.operator.type === "BooleanOperator") {
        const op = logic.operator;
        out.push({
          from: baseOffset + op.location.start,
          to: baseOffset + op.location.end,
          className: `filter-keyword filter-keyword-${op.operator.toLowerCase()}`,
        });
      }
      walkAst(logic.right, negated, baseOffset, out);
      return;
    }
    case "ParenthesizedExpression": {
      const paren = node as ParenthesizedExpressionToken;
      out.push({
        from: baseOffset + paren.location.start,
        to: baseOffset + paren.location.start + 1,
        className: "filter-paren",
      });
      out.push({
        from: baseOffset + paren.location.end - 1,
        to: baseOffset + paren.location.end,
        className: "filter-paren",
      });
      walkAst(paren.expression, negated, baseOffset, out);
      return;
    }
  }
}

function regexFallback(text: string, baseOffset: number): DecorationSlot[] {
  const out: DecorationSlot[] = [];
  FILTER_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILTER_TOKEN_REGEX.exec(text)) !== null) {
    const groups = match.groups ?? {};
    out.push({
      from: baseOffset + match.index,
      to: baseOffset + match.index + match[0].length,
      className: tagClassName({
        fieldName: groups.field ?? "",
        negated: !!groups.prefix,
      }),
    });
  }
  return out;
}

export function buildDecorationSlots(
  text: string,
  baseOffset = 0,
): DecorationSlot[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const leadingWs = text.length - text.trimStart().length;
  try {
    const ast = liqeParse(trimmed);
    const slots: DecorationSlot[] = [];
    walkAst(ast, false, baseOffset + leadingWs, slots);
    return slots;
  } catch {
    return regexFallback(text, baseOffset);
  }
}

export const FilterHighlight = Extension.create({
  name: "filterHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("filterHighlight"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const slot of buildDecorationSlots(node.text, pos)) {
                decorations.push(
                  Decoration.inline(slot.from, slot.to, {
                    class: slot.className,
                  }),
                );
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
