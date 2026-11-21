/**
 * LangWatchQL analytics SQL: what the set of an `IN` test may be written as. One shape check,
 * read by the validator and by the scope rewrite alike.
 * @see specs/lwql/api.feature, scenario: A set membership test names its set with a subquery
 */
import type { SqlAstNode } from "./langwatch-ql-parser.rules.ts";

/** The set membership tests, by the names `IN` and its variants parse to, lower-cased. */
const SET_MEMBERSHIP_FUNCTIONS: ReadonlySet<string> = new Set([
  "in",
  "notin",
  "globalin",
  "globalnotin",
]);

/** What a set may be written as, besides a function over these: never a plain name. */
const SET_OPERAND_TYPES: ReadonlySet<string> = new Set(["Subquery", "Literal", "QueryParameter"]);

function isNode(value: unknown): value is SqlAstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Whether a set operand holds a plain name, itself or in any function argument. */
function holdsPlainName(operand: unknown): boolean {
  if (!isNode(operand)) return true;
  if (operand.type !== "Function") return !SET_OPERAND_TYPES.has(operand.type);
  const args = Array.isArray(operand.arguments) ? operand.arguments : [];
  const params = Array.isArray(operand.parameters) ? operand.parameters : [];
  return [...args, ...params].some(holdsPlainName);
}

/**
 * The set operands of a membership test, in operator or function form, that hold a plain name,
 * itself or wrapped in a function. Empty for any other node, and for a set written as a subquery,
 * a literal, a function over literals or a query parameter.
 */
export function findNamedSetOperands(node: SqlAstNode): readonly unknown[] {
  const { name, arguments: args } = node;
  if (node.type !== "Function" || typeof name !== "string" || !Array.isArray(args)) return [];
  const functionName = name.trim().toLowerCase();
  if (!SET_MEMBERSHIP_FUNCTIONS.has(functionName)) return [];
  return args.slice(1).filter(holdsPlainName);
}
