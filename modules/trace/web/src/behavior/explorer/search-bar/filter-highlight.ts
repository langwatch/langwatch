import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import type {
  LiqeQuery,
  LogicalExpressionToken,
  ParenthesizedExpressionToken,
  TagToken,
  UnaryOperatorToken,
} from "liqe";
import { parse as cachedParse, SCENARIO_FIELDS, SEARCH_FIELDS } from "@langwatch/trace-contract";

/**
 * The grammar's actual operator vocabulary — anything else uppercase-shaped in
 * implicit-field position is a typo, not a deliberate free-text term.
 */
const GRAMMAR_OPERATOR_WORDS: ReadonlySet<string> = new Set(["AND", "OR", "NOT", "TO"]);
/**
 * Operator-shaped lexeme: 2–5 uppercase letters, surrounded by word boundaries.
 * Tightened from a generic ALL-CAPS pattern so all-caps proper nouns in free text
 * (`JSON`, `ASCII`, `OPENAI`, `GPT`) don't get false-flagged as operator typos.
 */
const OPERATOR_SHAPED_WORD_REGEX = /\b([A-Z]{2,5})\b/g;

// Tolerant fallback for queries that don't yet parse (mid-typing, unmatched quotes,
// trailing operator). Decorates anything shaped like `field:value` so users still get
// visual feedback while editing.
const FILTER_TOKEN_REGEX =
  /(?<prefix>NOT\s+|-)?(?<field>[a-zA-Z][a-zA-Z0-9_.]*):(?:"[^"]*"|\[[^\]]*\]|(?:>=|<=|>|<)[^\s()]+|[^\s()]+)/g;

export interface DecorationSlot {
  from: number;
  to: number;
  className: string;
  /**
   * Optional liqe-text-coordinate range for click-to-cycle on the AND/OR keyword.
   */
  opLoc?: { start: number; end: number };
  /**
   * Optional field+value+location reference for click-to-edit on the value chip. Set on
   * Tag slots; the editor's mousedown handler reads `data-filter-chip-start` etc. off
   * the inline span to open the value picker popover.
   */
  chipToken?: {
    start: number;
    end: number;
    field: string;
    value: string;
  };
}

/**
 * Identifies a Tag in the query — used by the per-token X button so the delete handler
 * knows which liqe node to drop.
 */
export interface TokenRef {
  start: number;
  end: number;
  field: string;
  value: string | null;
  kind: "ast" | "fallback";
}

interface DecorationPlan {
  slots: DecorationSlot[];
  tokens: TokenRef[];
  /** Leading-whitespace offset between original text and the parsed string. */
  leadingWs: number;
}

/** Fields whose value-shape is a number / range — get a green tint to
 * distinguish from categorical (blue) and scenario (purple). */
const NUMERIC_FIELDS = new Set([
  "duration",
  "cost",
  "tokens",
  "spans",
  "ttft",
  "promptTokens",
  "completionTokens",
  "tokensPerSecond",
]);

const DYNAMIC_FIELD_PREFIXES = [
  // Canonical, namespaced forms — root prefix is unique so autocomplete
  // can group cleanly without colliding keys.
  "trace.attribute.",
  "span.attribute.",
  "event.attribute.",
  // Legacy aliases preserved for back-compat with saved queries.
  "attribute.",
];

function isKnownField(fieldName: string): boolean {
  if (fieldName in SEARCH_FIELDS) return true;
  if (SCENARIO_FIELDS.has(fieldName)) return true;
  for (const prefix of DYNAMIC_FIELD_PREFIXES) {
    if (fieldName.startsWith(prefix) && fieldName.length > prefix.length) {
      return true;
    }
  }
  // Legacy single-dot `event.<key>` — kept as alias for back-compat. The
  // bare `event` field still routes to the static handler map (matches
  // `Events.Name`), so accept dotted forms only.
  if (fieldName.startsWith("event.") && fieldName.length > "event.".length) {
    return true;
  }
  return false;
}

function tagClassName({ fieldName, negated }: { fieldName: string; negated: boolean }): string {
  // Unknown field — the query parses, but no part of the platform knows
  // how to filter on it. Yellow/dashed treatment makes the typo obvious
  // before the user submits and gets zero rows.
  if (!isKnownField(fieldName)) return "filter-token filter-token-unknown-field";
  if (negated) return "filter-token filter-token-exclude";
  if (SCENARIO_FIELDS.has(fieldName)) return "filter-token filter-token-scenario";
  if (NUMERIC_FIELDS.has(fieldName)) return "filter-token filter-token-numeric";
  return "filter-token";
}

/**
 * Flag operator-shaped uppercase words that aren't part of the grammar's actual
 * operator vocabulary (`AND`, `OR`, `NOT`, `TO`). Driven entirely by
 * `GRAMMAR_OPERATOR_WORDS` — no curated list of typos.
 */
function flagOperatorShapedTypos(text: string, baseOffset: number, plan: DecorationPlan): void {
  OPERATOR_SHAPED_WORD_REGEX.lastIndex = 0;
  for (
    let match = OPERATOR_SHAPED_WORD_REGEX.exec(text);
    match !== null;
    match = OPERATOR_SHAPED_WORD_REGEX.exec(text)
  ) {
    const word = match[1] ?? "";
    const from = baseOffset + match.index;
    const to = from + word.length;
    if (isPositionCoveredBySlot(plan.slots, from, to)) continue;
    if (GRAMMAR_OPERATOR_WORDS.has(word)) {
      // `TO` only carries the keyword highlight inside `[N TO M]`; outside
      // that range it would visually fight with the value text. Skip it
      // here — the AST walk handles it when the range parses.
      if (word === "TO") continue;
      plan.slots.push({
        from,
        to,
        className: `filter-keyword filter-keyword-${word.toLowerCase()}`,
      });
      continue;
    }
    plan.slots.push({
      from,
      to,
      className: "filter-keyword filter-keyword-invalid",
    });
  }
}

function isPositionCoveredBySlot(slots: DecorationSlot[], from: number, to: number): boolean {
  for (const slot of slots) {
    if (from >= slot.from && to <= slot.to) return true;
  }
  return false;
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
        tag.expression.type === "LiteralExpression" ? String(tag.expression.value) : null;

      if (isImplicit) return; // free text — no chip, no X widget.
      // Token coords are in @-stripped trimmed-string space — same as what
      // `removeNodeAtLocation` will see when it re-parses the query.
      plan.tokens.push({
        start: tag.location.start,
        end: tag.location.end,
        field: fieldName,
        value,
        kind: "ast",
      });
      plan.slots.push({
        from: start,
        to: end,
        className: tagClassName({ fieldName, negated }),
        // Carry the parsed token coords through to the inline
        // decoration so the editor's mousedown delegate can open the
        // value picker without re-walking the AST. Only categorical
        // (literal-value) chips qualify — range chips have no
        // single-value picker.
        chipToken:
          value !== null
            ? {
                start: tag.location.start,
                end: tag.location.end,
                field: fieldName,
                value,
              }
            : undefined,
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
          className: `filter-keyword filter-keyword-${op.operator.toLowerCase()} filter-keyword-clickable`,
          // Carry the liqe-text coordinates through to the inline
          // decoration so the editor's click delegate can call
          // `swapOperatorAtLocation` without re-walking the AST.
          opLoc: { start: op.location.start, end: op.location.end },
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

function regexFallback(
  text: string,
  baseOffset: number,
): { slots: DecorationSlot[]; tokens: TokenRef[] } {
  const slots: DecorationSlot[] = [];
  const tokens: TokenRef[] = [];
  FILTER_TOKEN_REGEX.lastIndex = 0;
  for (
    let match = FILTER_TOKEN_REGEX.exec(text);
    match !== null;
    match = FILTER_TOKEN_REGEX.exec(text)
  ) {
    const groups = match.groups ?? {};
    const fieldName = groups.field ?? "";
    const negated = !!groups.prefix;
    const from = baseOffset + match.index;
    const to = from + match[0].length;
    slots.push({
      from,
      to,
      className: tagClassName({ fieldName, negated }),
    });
    // `start`/`end` are positions in the editor's *text content* (post
    // NBSP-normalisation, no trimming). The X-widget click handler keys
    // off `kind: "fallback"` to slice them out by string range — going
    // through `removeNodeAtLocation` would no-op while the parser is
    // failing, which is exactly when these tokens exist.
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      field: fieldName,
      value: null,
      kind: "fallback",
    });
  }
  return { slots, tokens };
}

export function buildDecorationPlan(text: string, baseOffset = 0): DecorationPlan {
  // The editor stores U+00A0 NBSP (we insert it after a value-accept so the browser
  // doesn't collapse the trailing space).
  const normalized = text.replace(/\u00A0/g, " ");
  const trimmed = normalized.trim();
  if (!trimmed) return { slots: [], tokens: [], leadingWs: 0 };
  const leadingWs = normalized.length - normalized.trimStart().length;
  try {
    const ast = cachedParse(trimmed);
    const plan: DecorationPlan = { slots: [], tokens: [], leadingWs };
    walkAst(ast, false, baseOffset + leadingWs, plan);
    flagOperatorShapedTypos(normalized, baseOffset, plan);
    return plan;
  } catch {
    const fallback = regexFallback(normalized, baseOffset);
    const plan: DecorationPlan = {
      slots: fallback.slots,
      tokens: fallback.tokens,
      leadingWs,
    };
    flagOperatorShapedTypos(normalized, baseOffset, plan);
    return plan;
  }
}

/** Backwards-compat shim used by the existing test suite. */
export function buildDecorationSlots(text: string, baseOffset = 0): DecorationSlot[] {
  return buildDecorationPlan(text, baseOffset).slots;
}

const DELETE_DATA_ATTR = "data-filter-delete";
const SVG_NS = "http://www.w3.org/2000/svg";

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
  btn.dataset.field = token.field;
  btn.dataset.kind = token.kind;
  if (token.value !== null) btn.dataset.value = token.value;
  // Mirror the chip's data-attrs onto the X button so the
  // chip-highlight CSS picks it up as part of the same chip — without
  // these, hovering the chip would tint just the field:value half and
  // leave the right-half X button in its original colour, breaking
  // the visual that the two halves form one pill.
  btn.dataset.filterChipField = token.field;
  if (token.value !== null) btn.dataset.filterChipValue = token.value;

  // Crisp SVG X — the "×" text glyph rendered chunky and uneven at this size.
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  const a = document.createElementNS(SVG_NS, "line");
  a.setAttribute("x1", "2");
  a.setAttribute("y1", "2");
  a.setAttribute("x2", "8");
  a.setAttribute("y2", "8");
  const b = document.createElementNS(SVG_NS, "line");
  b.setAttribute("x1", "8");
  b.setAttribute("y1", "2");
  b.setAttribute("x2", "2");
  b.setAttribute("y2", "8");
  svg.appendChild(a);
  svg.appendChild(b);
  btn.appendChild(svg);
  return btn;
}

/**
 * Module-level lookup table: `field → value → human-readable label`.
 */
let chipLabelLookup: Record<string, Record<string, string>> = {};

/**
 * Editor views the plugin is currently mounted in.
 */
const subscribedViews = new Set<EditorView>();

export const LABEL_REFRESH_META = "filterHighlight:labelRefresh" as const;

export function setFilterChipLabels(next: Record<string, Record<string, string>>): void {
  chipLabelLookup = next;
  for (const view of subscribedViews) {
    view.dispatch(view.state.tr.setMeta(LABEL_REFRESH_META, true));
  }
}

/**
 * The text the chip overlay paints at rest. Always field-qualified (`evaluator:Policy
 * Check`) so the field prefix stays put — only the value tail swaps to the raw id on
 * hover.
 */
export function chipOverlayLabel({
  field,
  value,
  label,
}: {
  field: string;
  value: string;
  label: string | undefined;
}): string | undefined {
  if (!label || label === value) return undefined;
  return `${field}:${label}`;
}

function computeDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const plan = buildDecorationPlan(node.text, pos);
    for (const slot of plan.slots) {
      const attrs: Record<string, string> = { class: slot.className };
      if (slot.opLoc) {
        attrs["data-filter-op-start"] = String(slot.opLoc.start);
        attrs["data-filter-op-end"] = String(slot.opLoc.end);
        attrs.title = "Click to switch AND ↔ OR";
      }
      if (slot.chipToken) {
        attrs["data-filter-chip-start"] = String(slot.chipToken.start);
        attrs["data-filter-chip-end"] = String(slot.chipToken.end);
        attrs["data-filter-chip-field"] = slot.chipToken.field;
        attrs["data-filter-chip-value"] = slot.chipToken.value;
        const overlay = chipOverlayLabel({
          field: slot.chipToken.field,
          value: slot.chipToken.value,
          label: chipLabelLookup[slot.chipToken.field]?.[slot.chipToken.value],
        });
        if (overlay) attrs["data-filter-chip-label"] = overlay;
      }
      decorations.push(Decoration.inline(slot.from, slot.to, attrs));
    }
    for (const token of plan.tokens) {
      // AST tokens carry liqe's trimmed-text coords, so we translate by `leadingWs` to
      // get a normalised-text offset. Fallback tokens were already collected against
      // the normalised text, so they need only the text-node base position.
      const widgetPos = token.kind === "ast" ? pos + plan.leadingWs + token.end : pos + token.end;
      decorations.push(
        Decoration.widget(widgetPos, () => createDeleteWidget(token), {
          side: 1,
          ignoreSelection: true,
          // Without an explicit key, ProseMirror's DecorationSet diff compared widget
          // specs by render-function reference equality.
          key: `del:${token.kind}:${token.field}:${token.start}:${token.end}:${token.value ?? ""}`,
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
            // Recompute on doc changes (normal path) AND on label-only
            // refreshes (facets arrived, chip labels need to materialise
            // even though the typed text didn't move). Without the meta
            // check, a no-op transaction wouldn't redraw and the chip
            // overlay would stay stale until the next keystroke.
            if (!tr.docChanged && !tr.getMeta(LABEL_REFRESH_META)) return prev;
            return computeDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return key.getState(state) ?? DecorationSet.empty;
          },
        },
        view(view) {
          subscribedViews.add(view);
          return {
            destroy() {
              subscribedViews.delete(view);
            },
          };
        },
      }),
    ];
  },
});
