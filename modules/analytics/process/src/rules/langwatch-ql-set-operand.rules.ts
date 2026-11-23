/**
 * LangWatchQL analytics SQL: what the set of an `IN` test may be written as. One shape check,
 * read by the validator and by the scope rewrite alike.
 * @see specs/lwql/api.feature, scenario: A set membership test names its set with a subquery
 */
import { isNode, type SqlAstNode } from "./langwatch-ql-parser.rules.ts";
import { DEFAULT_VIOLATION_HINTS } from "./langwatch-ql-violations.rules.ts";

/** What an `IN_TABLE_OPERAND` refusal tells the caller, from the validator and the scope step. */
export const IN_TABLE_OPERAND_MESSAGE = `The set of an IN test cannot be a plain name. ${DEFAULT_VIOLATION_HINTS.IN_TABLE_OPERAND}`;

/** The set membership tests, by the names `IN` and its variants parse to, lower-cased. */
const SET_MEMBERSHIP_FUNCTIONS: ReadonlySet<string> = new Set([
  "in",
  "notin",
  "globalin",
  "globalnotin",
]);

/** What a set may be written as, besides a value parameter or a function over these. */
const SET_OPERAND_TYPES: ReadonlySet<string> = new Set(["Subquery", "Literal"]);

/** Whether a query parameter binds a name rather than a value: `{t:Identifier}`, in any case. */
function bindsIdentifier(parameter: SqlAstNode): boolean {
  const { param_type: paramType } = parameter;
  if (typeof paramType !== "string") return true;
  const normalised = paramType.trim().toLowerCase();
  return normalised === "identifier";
}

/**
 * Whether a set operand holds a plain name, itself or in a function argument; an `Identifier`-typed
 * parameter is one, a lambda (whose names are its own parameters) is not. Whether a function may be
 * called at all (`numbers(10)` may not) is the validator's allowlist, not this rule's job.
 */
function holdsPlainName(operand: unknown): boolean {
  if (!isNode(operand)) return true;
  if (operand.type === "QueryParameter") return bindsIdentifier(operand);
  if (operand.type !== "Function") return !SET_OPERAND_TYPES.has(operand.type);
  if (operand.is_lambda_function === true) return false;
  const args = Array.isArray(operand.arguments) ? operand.arguments : [];
  const params = Array.isArray(operand.parameters) ? operand.parameters : [];
  return [...args, ...params].some(holdsPlainName);
}

/**
 * The set operands of a membership test, in operator or function form, that hold a plain name,
 * itself or wrapped in a function. Empty for any other node, and for a set written as a subquery,
 * a literal, a function over literals or a query parameter bound to a value.
 */
export function findNamedSetOperands(node: SqlAstNode): readonly unknown[] {
  const { name, arguments: args } = node;
  if (node.type !== "Function" || typeof name !== "string" || !Array.isArray(args)) return [];
  const functionName = name.trim().toLowerCase();
  if (!SET_MEMBERSHIP_FUNCTIONS.has(functionName)) return [];
  return args.slice(1).filter(holdsPlainName);
}
