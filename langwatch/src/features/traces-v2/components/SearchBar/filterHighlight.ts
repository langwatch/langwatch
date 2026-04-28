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
import { SCENARIO_FIELDS } from "~/server/app-layer/traces/query-language/queryParser";

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

/**
 * Identifies a Tag in the query — used by the per-token X button so the
 * delete handler knows which liqe node to drop. Locations are absolute
 * positions in the query text (not the @-stripped form, since the editor
 * never holds `@` characters in the new flow).
 */
export interface TokenRef {
  start: number;
  end: number;
  field: string | null;
  value: string | null;
}

interface DecorationPlan {
  slots: DecorationSlot[];
  tokens: TokenRef[];
  /** Leading-whitespace offset between original text and the parsed string. */
  leadingWs: number;
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
  plan: DecorationPlan,
): void {
  switch (node.type) {
    case "Tag": {
      const tag = node as TagToken;
      const start = baseOffset + tag.location.start;
      const end = baseOffset + tag.location.end;
      const isImplicit = tag.field.type === "ImplicitField";
      const fieldName = isImplicit ? "" : (tag.field as { name: string }).name;
      const value =
        tag.expression.type === "LiteralExpression"
          ? String(tag.expression.value)
          : null;

      // Token coords are in @-stripped trimmed-string space — same as what
      // `removeNodeAtLocation` will see when it re-parses the query.
      plan.tokens.push({
        start: tag.location.start,
        end: tag.location.end,
        field: isImplicit ? null : fieldName,
        value,
      });

      if (isImplicit) return; // free text — no inline accent
      plan.slots.push({
        from: start,
        to: end,
        className: tagClassName({ fieldName, negated }),
      });
      return;
    }
    case "UnaryOperator": {
      const unary = node as UnaryOperatorToken;
      const isNeg = unary.operator === "NOT" || unary.operator === "-";
      const kwLen = unary.operator === "NOT" ? 3 : 1;
      plan.slots.push({
        from: baseOffset + unary.location.start,
        to: baseOffset + unary.location.start + kwLen,
        className: "filter-keyword filter-keyword-not",
      });
      walkAst(unary.operand, negated !== isNeg, baseOffset, plan);
      return;
    }
    case "LogicalExpression": {
      const logic = node as LogicalExpressionToken;
      walkAst(logic.left, negated, baseOffset, plan);
      if (logic.operator.type === "BooleanOperator") {
        const op = logic.operator;
        plan.slots.push({
          from: baseOffset + op.location.start,
          to: baseOffset + op.location.end,
          className: `filter-keyword filter-keyword-${op.operator.toLowerCase()}`,
        });
      }
      walkAst(logic.right, negated, baseOffset, plan);
      return;
    }
    case "ParenthesizedExpression": {
      const paren = node as ParenthesizedExpressionToken;
      plan.slots.push({
        from: baseOffset + paren.location.start,
        to: baseOffset + paren.location.start + 1,
        className: "filter-paren",
      });
      plan.slots.push({
        from: baseOffset + paren.location.end - 1,
        to: baseOffset + paren.location.end,
        className: "filter-paren",
      });
      walkAst(paren.expression, negated, baseOffset, plan);
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

export function buildDecorationPlan(
  text: string,
  baseOffset = 0,
): DecorationPlan {
  // The editor stores U+00A0 NBSP (we insert it after a value-accept so the
  // browser doesn't collapse the trailing space). Normalise to regular space
  // before parsing so liqe sees a token boundary — otherwise the `AND`
  // typed after the accept glues into the previous Tag's value. Locations
  // returned from liqe are still character indices in the normalised
  // string, which has the same length as the original (1:1 substitution).
  const normalized = text.replace(/\u00A0/g, " ");
  const trimmed = normalized.trim();
  if (!trimmed) return { slots: [], tokens: [], leadingWs: 0 };
  const leadingWs = normalized.length - normalized.trimStart().length;
  try {
    const ast = liqeParse(trimmed);
    const plan: DecorationPlan = { slots: [], tokens: [], leadingWs };
    walkAst(ast, false, baseOffset + leadingWs, plan);
    return plan;
  } catch {
    return {
      slots: regexFallback(normalized, baseOffset),
      tokens: [],
      leadingWs,
    };
  }
}

/** Backwards-compat shim used by the existing test suite. */
export function buildDecorationSlots(
  text: string,
  baseOffset = 0,
): DecorationSlot[] {
  return buildDecorationPlan(text, baseOffset).slots;
}

const DELETE_DATA_ATTR = "data-filter-delete";

function createDeleteWidget(token: TokenRef): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "filter-token-delete";
  btn.setAttribute(DELETE_DATA_ATTR, "true");
  btn.setAttribute("contenteditable", "false");
  btn.setAttribute("aria-label", "Remove this filter");
  btn.setAttribute("tabindex", "-1");
  btn.dataset.locStart = String(token.start);
  btn.dataset.locEnd = String(token.end);
  if (token.field) btn.dataset.field = token.field;
  if (token.value !== null) btn.dataset.value = token.value;
  btn.textContent = "×";
  return btn;
}

function computeDecorations(doc: import("@tiptap/pm/model").Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const plan = buildDecorationPlan(node.text, pos);
    for (const slot of plan.slots) {
      decorations.push(
        Decoration.inline(slot.from, slot.to, { class: slot.className }),
      );
    }
    for (const token of plan.tokens) {
      const widgetPos = pos + plan.leadingWs + token.end;
      decorations.push(
        Decoration.widget(widgetPos, () => createDeleteWidget(token), {
          side: 1,
          ignoreSelection: true,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const FilterHighlight = Extension.create({
  name: "filterHighlight",

  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>("filterHighlight");
    return [
      new Plugin<DecorationSet>({
        key,
        // Cache decorations in plugin state. Reuse them across selection-only
        // transactions (cursor moves, focus changes) — the parse + decorate
        // pass is the expensive bit and shouldn't run when the text hasn't
        // changed. Cuts perceived typing lag dramatically.
        state: {
          init(_config, state) {
            return computeDecorations(state.doc);
          },
          apply(tr, prev) {
            if (!tr.docChanged) return prev;
            return computeDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return key.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
