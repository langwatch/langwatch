export type LiquidTokenType = "liquid-tag" | "variable" | "plain-text";

export interface LiquidToken {
  type: LiquidTokenType;
  value: string;
}

export interface LiquidVariableExtractionResult {
  inputVariables: string[];
  loopVariables: string[];
  assignedVariables: string[];
}

const LIQUID_KEYWORDS = new Set([
  "if",
  "elsif",
  "else",
  "endif",
  "unless",
  "endunless",
  "for",
  "endfor",
  "in",
  "assign",
  "capture",
  "endcapture",
  "case",
  "endcase",
  "when",
  "comment",
  "endcomment",
  "raw",
  "endraw",
  "break",
  "continue",
  "cycle",
  "tablerow",
  "endtablerow",
  "increment",
  "decrement",
  "include",
  "render",
  "true",
  "false",
  "nil",
  "null",
  "empty",
  "blank",
  "and",
  "or",
  "not",
  "contains",
  "limit",
  "offset",
  "reversed",
  "forloop",
]);

/** Splits Liquid tags, variables and surrounding text without evaluating it. */
export function tokenizeLiquidTemplate(text: string): LiquidToken[] {
  if (!text) return [];

  const tokens: LiquidToken[] = [];
  const liquidPattern = /(\{%.*?%\}|\{\{.*?\}\})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = liquidPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: "plain-text",
        value: text.substring(lastIndex, match.index),
      });
    }

    const value = match[0]!;
    tokens.push({
      type: value.startsWith("{{") ? "variable" : "liquid-tag",
      value,
    });
    lastIndex = match.index + value.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "plain-text", value: text.substring(lastIndex) });
  }

  return tokens;
}

/** Finds external inputs while excluding loop and assigned variables. */
export function extractLiquidVariables(
  text: string,
): LiquidVariableExtractionResult {
  const inputVariables = new Set<string>();
  const loopVariables = new Set<string>();
  const assignedVariables = new Set<string>();

  for (const token of tokenizeLiquidTemplate(text)) {
    if (token.type === "liquid-tag") {
      extractVariablesFromTag(token.value, {
        inputVariables,
        loopVariables,
        assignedVariables,
      });
    } else if (token.type === "variable") {
      extractVariablesFromExpression(token.value, inputVariables);
    }
  }

  for (const variable of loopVariables) inputVariables.delete(variable);
  for (const variable of assignedVariables) inputVariables.delete(variable);

  return {
    inputVariables: [...inputVariables],
    loopVariables: [...loopVariables],
    assignedVariables: [...assignedVariables],
  };
}

function extractVariablesFromExpression(
  expression: string,
  inputVariables: Set<string>,
): void {
  const variablePart = expression.slice(2, -2).trim().split("|")[0]?.trim();
  const rootVariable = variablePart?.split(".")[0]?.trim();
  if (rootVariable && !LIQUID_KEYWORDS.has(rootVariable)) {
    inputVariables.add(rootVariable);
  }
}

function extractVariablesFromTag(
  tag: string,
  context: {
    inputVariables: Set<string>;
    loopVariables: Set<string>;
    assignedVariables: Set<string>;
  },
): void {
  const parts = tag.slice(2, -2).trim().split(/\s+/);
  const keyword = parts[0];

  if (keyword === "for" && parts.length >= 4 && parts[2] === "in") {
    const iterator = parts[1]!;
    const collection = parts[3]!;
    context.loopVariables.add(iterator);

    if (!collection.startsWith("(")) {
      const rootCollection = collection.split(".")[0];
      if (rootCollection && !LIQUID_KEYWORDS.has(rootCollection)) {
        context.inputVariables.add(rootCollection);
      }
    }
    return;
  }

  if (keyword === "assign" && parts.length >= 2) {
    const assignedName = parts[1]!.replace(/=$/, "");
    if (assignedName) context.assignedVariables.add(assignedName);
    return;
  }

  if (keyword !== "if" && keyword !== "elsif" && keyword !== "unless") {
    return;
  }

  for (const part of parts.slice(1)) {
    if (isOperatorOrLiteral(part)) continue;
    const rootVariable = part.split(".")[0];
    if (rootVariable && !LIQUID_KEYWORDS.has(rootVariable)) {
      context.inputVariables.add(rootVariable);
    }
  }
}

function isOperatorOrLiteral(value: string): boolean {
  if (["==", "!=", "<", ">", "<=", ">="].includes(value)) return true;
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return true;
  }
  return /^\d+(\.\d+)?$/.test(value) || LIQUID_KEYWORDS.has(value);
}
