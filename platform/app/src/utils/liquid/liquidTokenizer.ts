/** Token types produced by the Liquid template tokenizer */
export type LiquidTokenType = "liquid-tag" | "variable" | "plain-text";

/** A single token from a Liquid template */
export interface LiquidToken {
  type: LiquidTokenType;
  value: string;
}

/**
 * Tokenizes a Liquid template string into an array of typed tokens.
 *
 * Recognizes three token types:
 * - `liquid-tag`: Liquid block tags like `{% if ... %}`, `{% for ... %}`, `{% assign ... %}`
 * - `variable`: Liquid variable expressions like `{{ name }}`, `{{ name | upcase }}`
 * - `plain-text`: Everything else
 *
 * Unclosed tags (e.g., `{% if x` without a closing `%}`) are treated as plain text.
 */
export function tokenizeLiquidTemplate(text: string): LiquidToken[] {
  if (!text) return [];

  const tokens: LiquidToken[] = [];
  // Match {% ... %} (liquid tags) and {{ ... }} (variable expressions)
  const liquidPattern = /(\{%.*?%\}|\{\{.*?\}\})/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = liquidPattern.exec(text)) !== null) {
    // Add any plain text before this match
    if (match.index > lastIndex) {
      tokens.push({
        type: "plain-text",
        value: text.substring(lastIndex, match.index),
      });
    }

    const matched = match[0]!;

    if (matched.startsWith("{{")) {
      tokens.push({ type: "variable", value: matched });
    } else {
      tokens.push({ type: "liquid-tag", value: matched });
    }

    lastIndex = match.index + matched.length;
  }

  // Add any remaining plain text after the last match
  if (lastIndex < text.length) {
    tokens.push({
      type: "plain-text",
      value: text.substring(lastIndex),
    });
  }

  return tokens;
}

/** Liquid keywords that should never be treated as variables */
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

/** Result of extracting variables from a Liquid template */
export interface LiquidVariableExtractionResult {
  /** Variables that need to be provided as input to the template */
  inputVariables: string[];
  /** Variables defined via loop iterators (e.g., `item` in `for item in items`) */
  loopVariables: string[];
  /** Variables defined via `assign` tags */
  assignedVariables: string[];
}

/**
 * Extracts variables from a Liquid template, classifying them as input,
 * loop, or assigned variables.
 *
 * - Input variables: variables that need to be provided externally
 * - Loop variables: iterators defined in `for` loops (not template inputs)
 * - Assigned variables: variables defined via `{% assign %}` (not template inputs)
 *
 * Liquid keywords (if, for, endfor, etc.) and filter names (upcase, truncate, etc.)
 * are never treated as variables.
 */
export function extractLiquidVariables(
  text: string,
): LiquidVariableExtractionResult {
  const tokens = tokenizeLiquidTemplate(text);

  const inputVariables = new Set<string>();
  const loopVariables = new Set<string>();
  const assignedVariables = new Set<string>();

  for (const token of tokens) {
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

  // Remove loop and assigned variables from input variables
  for (const v of loopVariables) {
    inputVariables.delete(v);
  }
  for (const v of assignedVariables) {
    inputVariables.delete(v);
  }

  return {
    inputVariables: Array.from(inputVariables),
    loopVariables: Array.from(loopVariables),
    assignedVariables: Array.from(assignedVariables),
  };
}

/**
 * Extracts variable names from a `{{ ... }}` expression.
 * Handles filters by only extracting the variable before the first `|`.
 */
function extractVariablesFromExpression(
  expression: string,
  inputVariables: Set<string>,
): void {
  // Remove {{ and }}
  const inner = expression.slice(2, -2).trim();
  if (!inner) return;

  // Split on `|` to separate variable from filters
  const parts = inner.split("|");
  const variablePart = parts[0]!.trim();

  if (!variablePart) return;

  // Extract the root variable name (handle dot notation like item.name)
  const rootVariable = variablePart.split(".")[0]!.trim();

  if (rootVariable && !LIQUID_KEYWORDS.has(rootVariable)) {
    inputVariables.add(rootVariable);
  }
}

/**
 * Extracts variables from a `{% ... %}` tag.
 * Handles for loops (identifies iterator vs collection), assign tags,
 * and conditional tags (if/elsif).
 */
function extractVariablesFromTag(
  tag: string,
  context: {
    inputVariables: Set<string>;
    loopVariables: Set<string>;
    assignedVariables: Set<string>;
  },
): void {
  // Remove {% and %}
  const inner = tag.slice(2, -2).trim();
  if (!inner) return;

  const parts = inner.split(/\s+/);
  const keyword = parts[0]!;

  if (keyword === "for" && parts.length >= 4 && parts[2] === "in") {
    // {% for item in items %} - item is loop var, items is input var
    // {% for i in (1..5) %} - i is loop var, (1..5) is a range literal (not a variable)
    const iterator = parts[1]!;
    const collection = parts[3]!;

    context.loopVariables.add(iterator);

    // Skip range literals like (1..5) or (1..items.size)
    if (!collection.startsWith("(")) {
      const rootCollection = collection.split(".")[0]!;
      if (rootCollection && !LIQUID_KEYWORDS.has(rootCollection)) {
        context.inputVariables.add(rootCollection);
      }
    }
  } else if (keyword === "assign" && parts.length >= 2) {
    // {% assign greeting = 'Hello' %} - greeting is assigned
    const assignedName = parts[1]!;
    // Remove trailing = if attached
    const cleanName = assignedName.replace(/=$/, "");
    if (cleanName) {
      context.assignedVariables.add(cleanName);
    }
  } else if (keyword === "if" || keyword === "elsif" || keyword === "unless") {
    // {% if tone == 'formal' %} - extract variable identifiers from condition
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!;
      // Skip operators, string literals, numbers, and keywords
      if (isOperatorOrLiteral(part)) continue;
      // Extract root variable (handle dot notation)
      const rootVariable = part.split(".")[0]!;
      if (rootVariable && !LIQUID_KEYWORDS.has(rootVariable)) {
        context.inputVariables.add(rootVariable);
      }
    }
  }
  // else/endif/endfor etc. have no variables to extract
}

/** Checks if a string is an operator, string literal, or number */
function isOperatorOrLiteral(value: string): boolean {
  // Comparison operators
  if (["==", "!=", "<", ">", "<=", ">="].includes(value)) return true;

  // String literals (single or double quoted)
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return true;
  }

  // Numbers
  if (/^\d+(\.\d+)?$/.test(value)) return true;

  // Liquid keywords
  if (LIQUID_KEYWORDS.has(value)) return true;

  return false;
}
