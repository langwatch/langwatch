import {
  type SqlSourcePosition,
  type LangWatchQLAppFunctionCall,
  type LangWatchQLAppFunctionOption,
  type LangWatchQLAppFunctionSource,
  type LangWatchQLClause,
  type LangWatchQLViolation,
  type LangWatchQLViolationCode,
} from "@langwatch/analytics-contract";
import { LWQL_MAX_RESULT_ROWS } from "@langwatch/analytics-contract/langwatch-ql-limits";

/**
 * LangWatchQL AST validator: defense in depth behind the database's own row-policy isolation.
 * An allowlist over node KINDS and FIELDS -- unlisted is refused -- so new parser syntax on an
 * existing node arrives refused, not silently admitted; functions are name-allowlisted separately.
 * @see specs/lwql/api.feature
 * @see dev/docs/adr/081-lwql-table-function-and-ssrf-policy.md
 * @see ../services/langwatch-ql-access-model.service.ts — the database isolation this backs up
 */
import { readAppFunctionArguments } from "./langwatch-ql-app-function-arguments.rules.ts";
import {
  findLangWatchQLAppFunctions,
  lwqlAppFunctionSignature,
} from "./langwatch-ql-app-function-catalog.rules.ts";
import type { LangWatchQLAppFunctionDefinition } from "./langwatch-ql-app-function-shapes.rules.ts";
import { isEvalFunctionName } from "./langwatch-ql-eval-function-catalog.rules.ts";
import {
  isAllowedLangWatchQLFunction,
  isLangWatchQLAggregateFunction,
  LWQL_ALLOWED_FUNCTION_NAMES,
} from "./langwatch-ql-functions.rules.ts";
import type { SqlAstNode } from "./langwatch-ql-parser.rules.ts";
import { qualifyTableName } from "./langwatch-ql-policy.rules.ts";
import {
  type BlockAccumulator,
  type FieldArgs,
  type FieldRule,
  type Frame,
  MAX_VIOLATIONS,
  METADATA_FIELDS,
  type NodeArgs,
  type NodeRule,
  UNRESOLVABLE_COLUMN_SETS,
  type WalkContext,
} from "./langwatch-ql-validation-shape.rules.ts";
import { DEFAULT_VIOLATION_HINTS, echoIdentifier } from "./langwatch-ql-violations.rules.ts";

/** The frame the outermost statement is walked in. */
export const ROOT_FRAME: Frame = {
  clause: "statement",
  isInSubquery: false,
  subqueryDepth: 0,
  nodeDepth: 0,
  ctes: [],
};

/** Appends a name the accumulator has not seen, preserving first-seen order. */
function addOnce(names: string[], name: string): void {
  if (!names.includes(name)) names.push(name);
}

// ---------------------------------------------------------------------------
// Small readers — every one of them treats a surprising shape as a refusal
// rather than a crash, because the input is a tree built from hostile text.
// ---------------------------------------------------------------------------

function isNode(value: unknown): value is SqlAstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

export function extractPosition(node: SqlAstNode): SqlSourcePosition | undefined {
  const start = (node as { location?: { start?: unknown } }).location?.start;
  if (typeof start !== "object" || start === null) return undefined;
  const { line, column } = start as { line?: unknown; column?: unknown };
  if (typeof line !== "number" || typeof column !== "number") return undefined;
  return { line, column };
}

/** The sharper fields a call site can attach on top of the hint floor. */
type ViolationExtra = Partial<
  Pick<LangWatchQLViolation, "availableViews" | "view" | "availableColumns" | "maxRows">
>;

function report({
  ctx,
  frame,
  code,
  message,
  node,
  extra,
}: {
  ctx: WalkContext;
  frame: Frame;
  code: LangWatchQLViolationCode;
  message: string;
  node?: SqlAstNode;
  extra?: ViolationExtra;
}): void {
  if (ctx.violations.length >= MAX_VIOLATIONS) return;
  const at = node ? extractPosition(node) : undefined;
  ctx.violations.push({
    code,
    clause: frame.isInSubquery ? "subquery" : frame.clause,
    message,
    hint: DEFAULT_VIOLATION_HINTS[code],
    ...(at ? { at } : {}),
    // Derived from the code, so the allowlist can ride on no other refusal nor miss this one.
    ...(code === "FUNCTION_NOT_ALLOWED" ? { allowedFunctions: LWQL_ALLOWED_FUNCTION_NAMES } : {}),
    ...extra,
  });
}

const UNSUPPORTED_SYNTAX_MESSAGE =
  "This query uses SQL this API does not support. Rewrite it as a plain read query over the analytics views.";

/**
 * The default-deny fallthrough. Names neither the node kind nor the field: those are the
 * parser's vocabulary, not the customer's, and a message that recites them tells an attacker
 * which internal representation the gate is built on while telling a customer nothing.
 */
function refuseUnrecognised({ ctx, frame, node }: NodeArgs): void {
  report({
    ctx,
    frame,
    code: "UNSUPPORTED_SYNTAX",
    message: UNSUPPORTED_SYNTAX_MESSAGE,
    node,
  });
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

const TOO_DEEP_MESSAGE = "This query nests too deeply. Flatten it and try again.";

/** The rule for a node kind, or `undefined` — which is the refusal. */
function pickRule(type: string): NodeRule | undefined {
  return Object.hasOwn(NODE_RULES, type) ? NODE_RULES[type] : undefined;
}

export function walkNode(node: SqlAstNode, frame: Frame, ctx: WalkContext): void {
  if (ctx.violations.length >= MAX_VIOLATIONS) return;

  const here: Frame = { ...frame, nodeDepth: frame.nodeDepth + 1 };
  const isTooDeep = here.nodeDepth > ctx.policy.limits.maxNodeDepth;
  if (isTooDeep) {
    report({
      ctx,
      frame,
      code: "NESTING_TOO_DEEP",
      message: TOO_DEEP_MESSAGE,
      node,
    });
    return;
  }

  const rule = pickRule(node.type);
  if (!rule) {
    refuseUnrecognised({ node, frame: here, ctx });
    return;
  }

  const childFrame = rule.enter ? rule.enter({ node, frame: here, ctx }) : here;
  if (childFrame) walkFields({ rule, node, frame: childFrame, ctx });
}

/**
 * `from` first, everything else in the parser's order: a gated-column refusal names the view it
 * was read from, so a `SELECT`'s table must be on its block before its projection is walked.
 * The sort is stable, so nothing else moves.
 */
function fieldsInWalkOrder(node: SqlAstNode): [string, unknown][] {
  return Object.entries(node).toSorted(([left], [right]) => {
    if (left === "from") return right === "from" ? 0 : -1;
    if (right === "from") return 1;
    return 0;
  });
}

/** Every field the node carries, each against the rule that names it — or none. */
function walkFields({ rule, node, frame, ctx }: NodeArgs & { rule: NodeRule }): void {
  for (const [field, value] of fieldsInWalkOrder(node)) {
    if (METADATA_FIELDS.includes(field) || value === undefined) continue;
    const fieldRule = Object.hasOwn(rule.fields, field) ? rule.fields[field] : undefined;
    if (fieldRule) applyFieldRule({ rule: fieldRule, value, node, frame, ctx });
    else refuseUnrecognised({ node, frame, ctx });
  }
}

function applyFieldRule({ rule, value, node, frame, ctx }: FieldArgs & { rule: FieldRule }): void {
  switch (rule.kind) {
    case "scalar":
      return;
    case "enum":
      return checkEnumValue({ values: rule.values, value, node, frame, ctx });
    case "refuse":
      return report({
        ctx,
        frame,
        code: rule.code,
        message: rule.message,
        node,
      });
    case "identifierRef":
      return checkIdentifierRef({ value, node, frame, ctx });
    case "node":
      return walkChildNode({ clause: rule.clause, value, node, frame, ctx });
    case "nodes":
      return walkChildNodes({ clause: rule.clause, value, node, frame, ctx });
    case "custom":
      return rule.walk({ value, node, frame, ctx });
  }
}

function checkEnumValue({
  values,
  value,
  node,
  frame,
  ctx,
}: FieldArgs & { values: readonly string[] }): void {
  if (typeof value === "string" && values.includes(value)) return;
  refuseUnrecognised({ node, frame, ctx });
}

/**
 * A table or alias qualifier. Its shape is checked; its name is not a column
 * reference, so the content gate deliberately does not apply to it.
 */
function checkIdentifierRef({ value, node, frame, ctx }: FieldArgs): void {
  if (isNode(value) && value.type === "Identifier" && typeof value.name === "string") {
    return;
  }
  refuseUnrecognised({ node, frame, ctx });
}

function walkChildNode({
  clause,
  value,
  node,
  frame,
  ctx,
}: FieldArgs & { clause?: LangWatchQLClause }): void {
  if (!isNode(value)) {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  walkNode(value, clause ? { ...frame, clause } : frame, ctx);
}

function walkChildNodes({
  clause,
  value,
  node,
  frame,
  ctx,
}: FieldArgs & { clause?: LangWatchQLClause }): void {
  if (!Array.isArray(value)) {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  const childFrame = clause ? { ...frame, clause } : frame;
  for (const element of value) {
    walkChildNode({ value: element, node, frame: childFrame, ctx });
  }
}

// ---------------------------------------------------------------------------
// Custom field walkers
// ---------------------------------------------------------------------------

/**
 * The view a gated reference's usable columns are listed against, when the walk can tell: the
 * segment before the gated one resolves through the block's aliases and tables; otherwise only a
 * block reading exactly one table resolves. The gated names are subtracted from the list.
 */
function resolveGatedColumnView({
  segments,
  gatedIndex,
  frame,
  ctx,
}: {
  segments: readonly string[];
  gatedIndex: number;
  frame: Frame;
  ctx: WalkContext;
}): ViolationExtra {
  const tables = frame.block?.tables ?? [];
  const qualifier = gatedIndex > 0 ? segments[gatedIndex - 1]?.trim().toLowerCase() : undefined;
  const byQualifier = qualifier
    ? tables.find(
        (entry) => entry.alias === qualifier || entry.table.split(".").at(-1) === qualifier,
      )
    : undefined;
  const matched = byQualifier ?? (tables.length === 1 ? tables[0] : undefined);
  if (!matched) return {};
  const availableColumns = ctx.policy.viewColumns
    .get(matched.table)
    ?.filter((column) => !ctx.policy.gatedColumns.has(column.trim().toLowerCase()));
  return {
    view: matched.table,
    ...(availableColumns ? { availableColumns } : {}),
  };
}

/**
 * The columns a caller may not reference, matched against every segment of a dotted name:
 * `body.null` and `traces.body.null` both read the withheld `body` before a subfield of it.
 */
function gateColumnReference({
  name,
  nameParts,
  ctx,
  frame,
  node,
}: {
  name: string;
  nameParts?: readonly string[];
  ctx: WalkContext;
  frame: Frame;
  node: SqlAstNode;
}): void {
  const segments = nameParts ?? name.split(".");
  const gatedIndex = segments.findIndex((segment) =>
    ctx.policy.gatedColumns.has(segment.trim().toLowerCase()),
  );
  if (gatedIndex === -1) return;
  report({
    ctx,
    frame,
    code: "GATED_COLUMN",
    message: `The field "${echoIdentifier(name)}" is not available to you. Remove it from the query.`,
    node,
    extra: resolveGatedColumnView({ segments, gatedIndex, frame, ctx }),
  });
}

/**
 * A projection list, walked like any other node list except for a direct element calling an app
 * function — the one position an app function is allowed in. Wildcards go through the same
 * `walkChildNode` every list uses, where {@link visitColumnSet} refuses them in any position.
 */
function walkProjection({ value, node, frame, ctx }: FieldArgs): void {
  if (!Array.isArray(value)) {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  const projection: Frame = { ...frame, clause: "projection" };
  for (const element of value) {
    const [definition] = isNode(element) ? directAppFunctionCalls(element) : [];
    if (definition && isNode(element)) {
      walkAppFunctionCall({ node: element, definition, frame: projection, ctx });
      continue;
    }
    walkChildNode({ value: element, node, frame: projection, ctx });
  }
}

// App functions: the one rule here is correctness, not policy. ClickHouse
// holds each as a projection UDF over its key, so a call in a WHERE compares
// the raw key and answers wrong rows with no error. @see specs/lwql/app-functions.feature

/** The catalogue entries a direct projection element calls. One or none. */
function directAppFunctionCalls(element: SqlAstNode): readonly LangWatchQLAppFunctionDefinition[] {
  if (element.type !== "Function") return [];
  if (typeof element.name !== "string") return [];
  return findLangWatchQLAppFunctions(element.name);
}

const APP_FUNCTION_POSITION_PLACE =
  "can only be used in the top-level SELECT list of a single SELECT statement, with an alias.";

/** An extraction function's value is a column, so it can be filtered on. */
const APP_FUNCTION_POSITION_EXTRACTION_ADVICE =
  "Project it there and filter, group or sort on a plain column instead.";

/** An eval function's answer arrives after the query, so there is no column. */
const APP_FUNCTION_POSITION_EVAL_ADVICE =
  "Its answer is decided after the query runs, so there is no column in this statement to filter on. " +
  "To keep only the matches, filter the rows it returns, " +
  "or run the statement as an Instant Eval and read `instant-eval results <run-id> --matched`.";

function appFunctionPositionMessage(name: string): string {
  const advice = isEvalFunctionName(name)
    ? APP_FUNCTION_POSITION_EVAL_ADVICE
    : APP_FUNCTION_POSITION_EXTRACTION_ADVICE;
  return `The function "${echoIdentifier(name)}" ${APP_FUNCTION_POSITION_PLACE} ${advice}`;
}

function reportAppFunctionPosition({
  name,
  node,
  frame,
  ctx,
}: {
  name: string;
  node: SqlAstNode;
  frame: Frame;
  ctx: WalkContext;
}): void {
  report({
    ctx,
    frame,
    code: "APP_FUNCTION_POSITION",
    message: appFunctionPositionMessage(name),
    node,
  });
}

/**
 * Whether the call was written in ClickHouse's parametric form,
 * `f(params)(args)`: the parser keeps the first list under `parameters`.
 */
function isParametricCall(node: SqlAstNode): boolean {
  return Array.isArray(node.parameters);
}

/**
 * An app function is a lambda with one argument list. The parametric form
 * would pass on its `arguments` alone and then reach ClickHouse, which has no
 * parametric UDF of that name, so it is refused where the refusal can name it.
 */
function reportParametricAppFunctionCall({
  name,
  node,
  frame,
  ctx,
}: {
  name: string;
  node: SqlAstNode;
  frame: Frame;
  ctx: WalkContext;
}): void {
  report({
    ctx,
    frame,
    code: "APP_FUNCTION_ARGUMENT",
    message: `The function "${echoIdentifier(name)}" takes one list of arguments, not a parameter list followed by one: write it as ${name}(...) rather than ${name}(...)(...).`,
    node,
  });
}

/** What reading a nested key found: nothing of ours, a refusal, or a source. */
type NestedSourceRead =
  | { readonly kind: "not_an_app_function" }
  | { readonly kind: "refused" }
  | { readonly kind: "source"; readonly source: LangWatchQLAppFunctionSource };

/**
 * One call in the projection: every rule, then the plan entry. Keeps going
 * where it can, so two mistakes are reported at once; a refused query has no
 * plan, because half a plan is a plan for a query that never runs.
 */
function walkAppFunctionCall({
  node,
  definition,
  frame,
  ctx,
}: {
  node: SqlAstNode;
  definition: LangWatchQLAppFunctionDefinition;
  frame: Frame;
  ctx: WalkContext;
}): void {
  if (isParametricCall(node)) {
    reportParametricAppFunctionCall({ name: definition.name, node, frame, ctx });
    return;
  }

  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const nested = walkAppFunctionArguments({ node, definition, args, frame, ctx });

  if (frame.isOutermostSelect !== true) {
    reportAppFunctionPosition({ name: definition.name, node, frame, ctx });
    return;
  }

  const [column] = admitAppFunctionCall({ node, definition, frame, ctx });
  if (column === undefined) return;

  const options = readAppFunctionOptions({ definition, args, node, frame, ctx });
  if (!options.ok) return;

  // A nested call that was itself refused leaves no plan: the statement is
  // already rejected, and half a plan is a plan for a query that never runs.
  if (nested.kind === "refused") return;

  const call: LangWatchQLAppFunctionCall = {
    column,
    function: definition.name,
    options: options.options,
    ...(nested.kind === "source" ? { source: nested.source } : {}),
  };
  ctx.appFunctions.push(call);
}

/**
 * The arguments, plus the nested extraction in the first one where there is
 * one. The frame drops `isOutermostSelect`, which refuses nesting everywhere
 * except the one place it is allowed: the key of an eval function.
 */
function walkAppFunctionArguments({
  node,
  definition,
  args,
  frame,
  ctx,
}: {
  node: SqlAstNode;
  definition: LangWatchQLAppFunctionDefinition;
  args: readonly unknown[];
  frame: Frame;
  ctx: WalkContext;
}): NestedSourceRead {
  const inside: Frame = { ...frame, isOutermostSelect: false };
  const nested: NestedSourceRead =
    definition.kind === "eval"
      ? readNestedSource({ key: args[0], frame: inside, ctx })
      : { kind: "not_an_app_function" };
  for (const [index, argument] of args.entries()) {
    if (nested.kind !== "not_an_app_function" && index === 0) continue;
    walkChildNode({ value: argument, node, frame: inside, ctx });
  }
  return nested;
}

/**
 * Whether a nested call has the shape a source may take at all: one argument
 * list, and an extraction rather than another eval.
 */
function isNestedCallAdmitted({
  nested,
  key,
  frame,
  ctx,
}: {
  nested: LangWatchQLAppFunctionDefinition;
  key: SqlAstNode;
  frame: Frame;
  ctx: WalkContext;
}): boolean {
  if (isParametricCall(key)) {
    reportParametricAppFunctionCall({ name: nested.name, node: key, frame, ctx });
    return false;
  }
  if (nested.kind !== "extraction") {
    reportAppFunctionPosition({ name: nested.name, node: key, frame, ctx });
    return false;
  }
  return true;
}

/**
 * The extraction an eval reads its text from. One level, and an extraction
 * only: a second one would have no key of its own, and an eval inside an eval
 * would ask the classifier about a probability.
 */
function readNestedSource({
  key,
  frame,
  ctx,
}: {
  key: unknown;
  frame: Frame;
  ctx: WalkContext;
}): NestedSourceRead {
  if (!isNode(key) || key.type !== "Function") return { kind: "not_an_app_function" };
  if (typeof key.name !== "string") return { kind: "not_an_app_function" };
  const [nested] = findLangWatchQLAppFunctions(key.name);
  if (!nested) return { kind: "not_an_app_function" };
  if (!isNestedCallAdmitted({ nested, key, frame, ctx })) return { kind: "refused" };

  // Its own arguments, under a frame that is still not the outermost select,
  // so anything nested inside IT is refused by the ordinary function walk.
  const args = Array.isArray(key.arguments) ? key.arguments : [];
  for (const argument of args) {
    walkChildNode({ value: argument, node: key, frame, ctx });
  }

  if (key.name.trim() !== nested.name) {
    report({
      ctx,
      frame,
      code: "APP_FUNCTION_NAME_CASE",
      message: nameCaseMessage({ written: key.name.trim(), definition: nested }),
      node: key,
    });
    return { kind: "refused" };
  }

  if (!holdsAppFunctionGates({ definition: nested, ctx })) {
    report({
      ctx,
      frame,
      code: "APP_FUNCTION_GATED",
      message: gatedMessage(nested),
      node: key,
    });
    return { kind: "refused" };
  }

  const options = readAppFunctionOptions({ definition: nested, args, node: key, frame, ctx });
  if (!options.ok) return { kind: "refused" };
  return { kind: "source", source: { function: nested.name, options: options.options } };
}

function nameCaseMessage({
  written,
  definition,
}: {
  written: string;
  definition: LangWatchQLAppFunctionDefinition;
}): string {
  return `Write "${echoIdentifier(written)}" as "${definition.name}": the query runs exactly as written, and the database matches this function's name letter for letter.`;
}

function gatedMessage(definition: LangWatchQLAppFunctionDefinition): string {
  return `The function "${echoIdentifier(definition.name)}" is not available to you. It needs the ${definition.gates.join(" and ")} permission; ask an administrator for it, or remove the call.`;
}

/**
 * The rules a call in the right place still has to pass, and the column it
 * earns. Empty means one failed and was reported. Spelling comes first: a
 * mis-cased call would plan a statement the database cannot run.
 */
function admitAppFunctionCall({
  node,
  definition,
  frame,
  ctx,
}: {
  node: SqlAstNode;
  definition: LangWatchQLAppFunctionDefinition;
  frame: Frame;
  ctx: WalkContext;
}): readonly string[] {
  const refuse = (code: LangWatchQLViolationCode, message: string): readonly string[] => {
    report({ ctx, frame, code, message, node });
    return [];
  };

  const written = typeof node.name === "string" ? node.name.trim() : "";
  if (written !== definition.name) {
    return refuse("APP_FUNCTION_NAME_CASE", nameCaseMessage({ written, definition }));
  }

  const [column] = aliasOf(node);
  if (column === undefined) {
    return refuse(
      "APP_FUNCTION_ALIAS_REQUIRED",
      `The function "${echoIdentifier(definition.name)}" needs an alias: write it as "${lwqlAppFunctionSignature(definition)} AS my_column".`,
    );
  }

  if (!holdsAppFunctionGates({ definition, ctx })) {
    return refuse("APP_FUNCTION_GATED", gatedMessage(definition));
  }

  if (definition.kind === "eval" && !ctx.policy.isInstantEvalsEnabled) {
    return refuse(
      "APP_FUNCTION_GATED",
      `The function "${echoIdentifier(definition.name)}" is not available to you. A judgement is charged to one project, so it needs Instant Evals switched on for a key that reads a single project; ask an administrator to enable them, use a project key, or remove the call.`,
    );
  }

  return [column];
}

/** The alias a projection element was written with. Empty when it has none. */
function aliasOf(node: SqlAstNode): readonly string[] {
  const { alias } = node;
  if (typeof alias !== "string") return [];
  const trimmed = alias.trim();
  return trimmed === "" ? [] : [trimmed];
}

/** Whether the caller holds every permission this function requires. */
function holdsAppFunctionGates({
  definition,
  ctx,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  ctx: WalkContext;
}): boolean {
  return definition.gates.every((gate) => ctx.policy.heldPermissions.has(gate));
}

/**
 * The literal option values, or the refusal that was reported. The rules
 * themselves are pure and live next door; this is the half that reports one.
 */
function readAppFunctionOptions({
  definition,
  args,
  node,
  frame,
  ctx,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  args: readonly unknown[];
  node: SqlAstNode;
  frame: Frame;
  ctx: WalkContext;
}):
  | { readonly ok: true; readonly options: readonly LangWatchQLAppFunctionOption[] }
  | { readonly ok: false } {
  const outcome = readAppFunctionArguments({ definition, args });
  if (outcome.ok) return { ok: true, options: outcome.options };
  report({ ctx, frame, code: "APP_FUNCTION_ARGUMENT", message: outcome.message, node });
  return { ok: false };
}

/**
 * `LIMIT n BY cols [OFFSET m]` — an anonymous object rather than a node, so it
 * gets its own field allowlist instead of a rule-table entry.
 */
function walkLimitBy({ value, node, frame, ctx }: FieldArgs): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  const limit: Frame = { ...frame, clause: "limit" };
  for (const [field, inner] of Object.entries(value)) {
    walkLimitByField({ field, value: inner, node, frame: limit, ctx });
  }
}

function walkLimitByField({ field, value, node, frame, ctx }: FieldArgs & { field: string }): void {
  if (value === undefined) return;
  if (field === "length" || field === "offset") {
    walkChildNode({ value, node, frame, ctx });
    return;
  }
  if (field === "by") {
    walkChildNodes({ value, node, frame, ctx });
    return;
  }
  refuseUnrecognised({ node, frame, ctx });
}

/** `INTERPOLATE (col AS expr)` — the interpolated column is a bare string. */
function walkInterpolatedColumn({ value, node, frame, ctx }: FieldArgs): void {
  if (typeof value !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  gateColumnReference({ name: value, ctx, frame, node });
}

// ---------------------------------------------------------------------------
// `enter` hooks — what a node decides before its fields are walked: the frame
// its children see, whether it is refused outright, and what it contributes to
// the block it sits in.
// ---------------------------------------------------------------------------

/**
 * The number a `LIMIT` literal spells, or `NaN` for an expression or bound parameter — whose
 * value is decided at run time, so it is neither refused as too high nor counted as absent.
 */
function limitLiteralValue(limit: unknown): number {
  if (!isNode(limit) || limit.type !== "Literal") return Number.NaN;
  const { value } = limit;
  return typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
}

/** Records how a top-level `SELECT` bounds its own result. A subquery's `SELECT` is skipped. */
function recordTopLevelLimit({ node, frame, ctx }: NodeArgs): void {
  if (frame.isInSubquery) return;
  const { limit, offset } = node;
  const at = isNode(limit) ? extractPosition(limit) : undefined;
  const offsetAt = isNode(offset) ? extractPosition(offset) : undefined;
  const rows = limitLiteralValue(limit);
  const isStaticRowCount = Number.isInteger(rows) && rows >= 0;
  ctx.topLevelLimits.push({
    hasLimit: limit !== undefined,
    hasOffset: offset !== undefined,
    ...(isStaticRowCount ? { staticRows: rows } : {}),
    ...(at ? { at } : {}),
    ...(offsetAt ? { offsetAt } : {}),
  });
}

/**
 * Refuses a top-level `LIMIT` above the row cap, and — for a `UNION` — any branch naming no
 * `LIMIT` of its own: each branch returns independently, so one appended default cannot bound
 * it. Runs after the walk, over what {@link recordTopLevelLimit} collected.
 */
export function reportRowLimitViolations(ctx: WalkContext): void {
  const maxRowsText = LWQL_MAX_RESULT_ROWS.toLocaleString("en-US");
  for (const limit of ctx.topLevelLimits) {
    if (limit.staticRows === undefined || limit.staticRows <= LWQL_MAX_RESULT_ROWS) continue;
    pushLimitViolation({
      ctx,
      code: "LIMIT_TOO_HIGH",
      message:
        `The LIMIT of ${limit.staticRows.toLocaleString("en-US")} rows is above the maximum of ` +
        `${maxRowsText} rows this API returns per request. ` +
        `Lower it and page the rest with LIMIT/OFFSET and an ORDER BY.`,
      at: limit.at,
    });
  }
  if (ctx.topLevelLimits.length <= 1) return;
  for (const limit of ctx.topLevelLimits) {
    if (limit.hasLimit) continue;
    pushLimitViolation({
      ctx,
      code: "LIMIT_REQUIRED_PER_BRANCH",
      message:
        "This UNION has a branch with no LIMIT of its own. Each branch runs and returns " +
        `independently, so every branch needs its own LIMIT of ${maxRowsText} rows or fewer.`,
      at: limit.at,
    });
  }
}

function pushLimitViolation({
  ctx,
  code,
  message,
  at,
}: {
  ctx: WalkContext;
  code: "LIMIT_TOO_HIGH" | "LIMIT_REQUIRED_PER_BRANCH";
  message: string;
  at?: SqlSourcePosition;
}): void {
  if (ctx.violations.length >= MAX_VIOLATIONS) return;
  ctx.violations.push({
    code,
    clause: "limit",
    message,
    hint: DEFAULT_VIOLATION_HINTS[code],
    maxRows: LWQL_MAX_RESULT_ROWS,
    ...(at ? { at } : {}),
  });
}

/**
 * Whether the service appends the default `LIMIT`, and before which `OFFSET`: only a single
 * top-level `SELECT` naming no `LIMIT`. An accepted `UNION` is already bounded per branch.
 */
export function rowLimitAppend(ctx: WalkContext): {
  appendRowLimit: boolean;
  appendRowLimitBeforeOffset?: SqlSourcePosition;
} {
  const [singleBranch] = ctx.topLevelLimits.length === 1 ? ctx.topLevelLimits : [];
  const appendRowLimit = singleBranch !== undefined && !singleBranch.hasLimit;
  const offsetAt = appendRowLimit && singleBranch.hasOffset ? singleBranch.offsetAt : undefined;
  return { appendRowLimit, ...(offsetAt ? { appendRowLimitBeforeOffset: offsetAt } : {}) };
}

/**
 * Marks the one `SELECT` whose projection may call an app function: only when
 * the root union holds exactly one, and cleared below it.
 */
function enterSelectWithUnionQuery({ node, frame }: NodeArgs): Frame {
  const isRoot =
    frame.clause === "statement" && frame.subqueryDepth === 0 && frame.block === undefined;
  const isSingle = Array.isArray(node.selects) && node.selects.length === 1;
  return { ...frame, isRootSelect: isRoot && isSingle };
}

/**
 * Opens this SELECT's block and brings its CTE names into scope, before
 * anything else is walked.
 */
function enterSelectQuery({ node, frame, ctx }: NodeArgs): Frame {
  recordTopLevelLimit({ node, frame, ctx });
  const isOutermostSelect = frame.isRootSelect === true;
  const block: BlockAccumulator = {
    tables: [],
    joins: [],
    filteredColumns: [],
    groupByColumns: [],
    hasGroupBy:
      (Array.isArray(node.group_by) && node.group_by.length > 0) || node.group_by_all === true,
    isAggregated: false,
  };
  ctx.blocks.push(block);

  // `isRootSelect` is spent here: it marked this SELECT as the outermost one,
  // and clearing it stops a subquery or a CTE body claiming the same standing.
  const here: Frame = { ...frame, block, isOutermostSelect, isRootSelect: false };
  if (!Array.isArray(node.with)) return here;
  const ctes = [...frame.ctes];
  for (const item of node.with) {
    if (isNode(item) && item.type === "WithElement" && typeof item.name === "string") {
      addOnce(ctes, item.name.trim().toLowerCase());
    }
  }
  return { ...here, ctes };
}

/** Descends one query level, or refuses when that would pass the ceiling. */
function visitSubquery({ node, frame, ctx }: NodeArgs): Frame | null {
  const subqueryDepth = frame.subqueryDepth + 1;
  const isTooDeep = subqueryDepth > ctx.policy.limits.maxSubqueryDepth;
  if (isTooDeep) {
    report({
      ctx,
      frame,
      code: "NESTING_TOO_DEEP",
      message:
        "This query nests subqueries or common table expressions too deeply. Flatten it and try again.",
      node,
    });
    return null;
  }
  return { ...frame, subqueryDepth, isInSubquery: true, clause: "subquery" };
}

/** A table reference written out in literal names, which is the only kind allowed. */
interface LiteralTableReference {
  readonly name: string;
  readonly database?: string;
  readonly alias?: string;
}

/**
 * Reads a table reference, or reports `null` for one whose parts are not literal names.
 */
function parseTableReference(node: SqlAstNode): LiteralTableReference | null {
  const { name, database, alias } = node;
  if (typeof name !== "string") return null;
  if (database !== undefined && typeof database !== "string") return null;
  if (alias !== undefined && typeof alias !== "string") return null;
  return {
    name,
    ...(database === undefined ? {} : { database }),
    ...(alias === undefined ? {} : { alias }),
  };
}

/** Checks a table reference against the reserved schemas, then the catalog. */
function visitTableIdentifier({ node, frame, ctx }: NodeArgs): Frame | null {
  const reference = parseTableReference(node);
  if (!reference) {
    report({
      ctx,
      frame,
      code: "TABLE_NOT_ALLOWED",
      message: "Name the view directly — a table cannot be chosen by a bound parameter.",
      node,
    });
    return null;
  }

  const database = reference.database?.trim().toLowerCase();
  const isReservedDatabase = database !== undefined && ctx.policy.reservedDatabases.has(database);
  if (isReservedDatabase) {
    report({
      ctx,
      frame,
      code: "SCHEMA_NOT_ALLOWED",
      message:
        "Server metadata is not readable through this API. Query the analytics views instead.",
      node,
    });
    return null;
  }

  // A `WITH` name resolves to its own subquery, which is validated on its own
  // terms; it is not a table reference and never was.
  const isCteName = frame.ctes.includes(reference.name.trim().toLowerCase());
  if (database === undefined && isCteName) {
    return frame;
  }

  const qualified = qualifyTableName({
    table: reference.name,
    database: reference.database,
    defaultDatabase: ctx.policy.defaultDatabase,
  });
  const isAllowedTable = ctx.policy.allowedTables.has(qualified);
  if (!isAllowedTable) {
    const written = reference.database ? `${reference.database}.${reference.name}` : reference.name;
    report({
      ctx,
      frame,
      code: "TABLE_NOT_ALLOWED",
      message: `The view "${echoIdentifier(written)}" is not available to you. Use one of the views from the schema endpoint.`,
      node,
      extra: { availableViews: ctx.policy.availableViews },
    });
    return null;
  }
  addOnce(ctx.tables, qualified);
  frame.block?.tables.push({
    table: qualified,
    ...(reference.alias ? { alias: reference.alias.trim().toLowerCase() } : {}),
  });
  return frame;
}

/**
 * How many nodes the join-key scan will look at before giving up. The scan runs inside {@link
 * enterTableJoin}, which is *before* the walk's own depth ceiling has descended into the `ON`
 * expression, so it cannot borrow that ceiling.
 */
const MAX_JOIN_KEY_SCAN_NODES = 200;

/** The name a side of a join equality was written with, or `null` if not a plain reference. */
function extractJoinSideName(value: unknown): string | null {
  if (!isNode(value) || value.type !== "Identifier") return null;
  return typeof value.name === "string" ? value.name : null;
}

/**
 * The equality pairs a `JOIN` was written on. Descends `AND` only.
 */
function collectJoinEdges({ node, block }: { node: SqlAstNode; block: BlockAccumulator }): void {
  collectUsingEdges({ using: node.using, block });
  collectOnEdges({ on: node.on, block });
}

/**
 * Records the pairs a `USING (col)` clause implies. `USING` matches the same name on both
 * sides, which is exactly the pair an `ON` would have spelled out.
 */
function collectUsingEdges({ using, block }: { using: unknown; block: BlockAccumulator }): void {
  if (!Array.isArray(using)) return;
  for (const element of using) {
    const name = extractJoinSideName(element);
    if (name !== null) block.joins.push({ left: name, right: name });
  }
}

/**
 * Records the equality pairs reachable from an `ON` condition through `AND`. Bounded by {@link
 * MAX_JOIN_KEY_SCAN_NODES}: the condition is caller-written, so the descent needs a ceiling
 * that does not depend on it being reasonable.
 */
function collectOnEdges({ on, block }: { on: unknown; block: BlockAccumulator }): void {
  const pending: unknown[] = [on];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_JOIN_KEY_SCAN_NODES) {
    visited += 1;
    const current = pending.pop();

    const conjuncts = extractConjunctArguments(current);
    if (conjuncts !== null) {
      pending.push(...conjuncts);
      continue;
    }

    const edge = parseEqualityEdge(current);
    if (edge !== null) block.joins.push(edge);
  }
}

/** The operands of an `AND`, or `null` for any other node. */
function extractConjunctArguments(node: unknown): unknown[] | null {
  if (!isNode(node) || node.type !== "Function") return null;
  if (node.name !== "and" || !Array.isArray(node.arguments)) return null;
  return node.arguments;
}

/**
 * The join edge an `a = b` node names, or `null` for anything else. Both sides have to resolve
 * to a name: an equality against an expression is not a key two datasets line up on, and
 * recording half of one would claim a match that was never written.
 */
function parseEqualityEdge(node: unknown): { left: string; right: string } | null {
  if (!isNode(node) || node.type !== "Function") return null;
  if (node.name !== "equals" || !Array.isArray(node.arguments)) return null;
  if (node.arguments.length !== 2) return null;
  const left = extractJoinSideName(node.arguments[0]);
  const right = extractJoinSideName(node.arguments[1]);
  return left !== null && right !== null ? { left, right } : null;
}

/** Records the join's key pairs, then lets the walk validate the condition itself. */
function enterTableJoin({ node, frame }: NodeArgs): Frame {
  if (frame.block) collectJoinEdges({ node, block: frame.block });
  return frame;
}

/**
 * Applies the function allowlist, and notes an aggregate for the block. Reports and keeps
 * descending rather than cutting the subtree off, so that a caller who used a refused function
 * *and* a restricted field hears about both in one round trip.
 */
function visitFunction({ node, frame, ctx }: NodeArgs): Frame | null {
  const { name } = node;
  if (typeof name !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return null;
  }
  // Reset on every call so an outer bare-`count(*)` exemption never leaks into this one's
  // fields; {@link walkFunctionArguments} sets it back for exactly the `arguments` field.
  const childFrame: Frame = { ...frame, isBareCountStarArgument: false };
  // Reaching here means this call is not a direct element of the outermost projection, so an
  // app-function name is a position violation — saying so beats the allowlist calling a
  // catalogued function "not allowed".
  const [appFunction] = findLangWatchQLAppFunctions(name);
  if (appFunction) {
    reportAppFunctionPosition({ name: appFunction.name, node, frame, ctx });
    return childFrame;
  }
  if (!isAllowedLangWatchQLFunction(name)) {
    reportRefusedFunction({ name, node, frame, ctx });
    return childFrame;
  }
  const collapsesRows = isLangWatchQLAggregateFunction(name) && !isWindowCall(node);
  if (childFrame.block && collapsesRows) {
    childFrame.block.isAggregated = true;
  }
  return childFrame;
}

/**
 * A `Function` node's `arguments`, walked with the bare-`count(*)` exemption scoped to this
 * field alone, so `count(*) OVER (PARTITION BY COLUMNS('…'))` still refuses the matcher.
 */
function walkFunctionArguments({ value, node, frame, ctx }: FieldArgs): void {
  walkChildNodes({
    value,
    node,
    frame: { ...frame, isBareCountStarArgument: isBareCountStar(node) },
    ctx,
  });
}

/**
 * Whether this call is a bare `count(*)`, the one place a star is a row count rather than a
 * column set. `count(DISTINCT *)` parses as `countDistinct`, and `count(t.*)`,
 * `count(* EXCEPT (…))` and `count(*, x)` all fall outside it.
 */
function isBareCountStar(node: SqlAstNode): boolean {
  const { name, arguments: args } = node;
  if (typeof name !== "string" || name.toLowerCase() !== "count") return false;
  if (!Array.isArray(args) || args.length !== 1) return false;
  const [arg] = args;
  return (
    isNode(arg) &&
    arg.type === "Asterisk" &&
    arg.transformers === undefined &&
    arg.expression === undefined
  );
}

const WILDCARD_NOT_ALLOWED_MESSAGE =
  "List the fields you need by name — a wildcard cannot be used here, because some fields are not available to you.";

/**
 * Refuses a wildcard or regexp `COLUMNS()` matcher in any position for a caller with restricted
 * fields, and does not walk the subtree. The star of a bare `count(*)` is exempt.
 */
function visitColumnSet({ node, frame, ctx }: NodeArgs): Frame | null {
  if (!UNRESOLVABLE_COLUMN_SETS.includes(node.type)) return frame;
  if (ctx.policy.gatedColumns.size === 0) return frame;
  if (frame.isBareCountStarArgument === true) return frame;
  report({ ctx, frame, code: "WILDCARD_NOT_ALLOWED", message: WILDCARD_NOT_ALLOWED_MESSAGE, node });
  return null;
}

/**
 * A `COLUMNS(a, b)` list matcher: walked when every member is an identifier, so each is gated
 * like any reference; refused like a wildcard when a member is not (`COLUMNS('a', 'b')`).
 */
function visitColumnListMatcher({ node, frame, ctx }: NodeArgs): Frame | null {
  if (ctx.policy.gatedColumns.size === 0) return frame;
  const members = node.columns;
  const isEveryMemberNamed =
    Array.isArray(members) &&
    members.every((member) => isNode(member) && member.type === "Identifier");
  if (isEveryMemberNamed) return frame;
  report({ ctx, frame, code: "WILDCARD_NOT_ALLOWED", message: WILDCARD_NOT_ALLOWED_MESSAGE, node });
  return null;
}

/** Whether this call is a window function rather than a row-collapsing aggregate. */
function isWindowCall(node: SqlAstNode): boolean {
  return (
    node.kind === "WINDOW_FUNCTION" ||
    node.is_window_function === true ||
    node.window_definition !== undefined ||
    node.window_name !== undefined
  );
}

function reportRefusedFunction({
  name,
  node,
  frame,
  ctx,
}: {
  name: string;
  node: SqlAstNode;
  frame: Frame;
  ctx: WalkContext;
}): void {
  report({
    ctx,
    frame,
    code: "FUNCTION_NOT_ALLOWED",
    message: `The function "${echoIdentifier(name)}" cannot be used here. Rewrite the expression using one of the supported functions, listed under \`functions\` on GET /api/v1/query/schema and carried on this violation as \`allowedFunctions\`.`,
    node,
  });
}

/**
 * `APPLY(f)` on a column set names its function as a bare string rather than as
 * a call, so the allowlist has to be applied here too — the one place a
 * function reaches the walk without a `Function` node around it.
 */
function walkApplyFunctionName({ value, node, frame, ctx }: FieldArgs): void {
  if (typeof value !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  const [appFunction] = findLangWatchQLAppFunctions(value);
  if (appFunction) {
    reportAppFunctionPosition({ name: appFunction.name, node, frame, ctx });
    return;
  }
  if (isAllowedLangWatchQLFunction(value)) return;
  reportRefusedFunction({ name: value, node, frame, ctx });
}

/** Applies the content gate to a column reference. */
function visitIdentifier({ node, frame, ctx }: NodeArgs): Frame | null {
  const { name, name_parts: nameParts } = node;
  if (typeof name !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return null;
  }
  // Compound names hold their segments here, and a segment may be a bound
  // parameter in identifier position rather than a string — which would let a
  // caller name a field the gate never sees.
  const isNonStringName =
    !Array.isArray(nameParts) || nameParts.some((part) => typeof part !== "string");
  const namesAnIdentifier = nameParts !== undefined && isNonStringName;
  if (namesAnIdentifier) {
    report({
      ctx,
      frame,
      code: "GATED_COLUMN",
      message: "Name the field directly — a field cannot be chosen by a bound parameter.",
      node,
    });
    return null;
  }
  const segments = Array.isArray(nameParts)
    ? nameParts.filter((part): part is string => typeof part === "string")
    : undefined;
  gateColumnReference({ name, nameParts: segments, ctx, frame, node });
  noteColumnPosition({ name, frame });
  return frame;
}

/**
 * Records a column named in a filter or grouping position on the block it sits in. The leaf
 * segment only: what a diagnostic asks is "was this dataset's time column filtered", and
 * `t.OccurredAt`, `OccurredAt` and `analytics.traces.OccurredAt` are all the same answer to it.
 */
function noteColumnPosition({ name, frame }: { name: string; frame: Frame }): void {
  const { block, clause } = frame;
  if (!block) return;
  if (clause !== "filter" && clause !== "group") return;
  const leaf = name.split(".").at(-1)?.trim().toLowerCase();
  if (!leaf) return;
  if (clause === "filter") addOnce(block.filteredColumns, leaf);
  else addOnce(block.groupByColumns, leaf);
}

/**
 * Records a bound parameter. Parameters are *values*, and values are permitted — but an
 * `Identifier`-typed one is not a value, and is refused.
 */
function visitQueryParameter({ node, frame, ctx }: NodeArgs): Frame | null {
  const { name, param_type: paramType } = node;
  if (typeof name !== "string" || typeof paramType !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return null;
  }
  const bindsIdentifier = paramType.trim().toLowerCase() === "identifier";
  if (bindsIdentifier) {
    report({
      ctx,
      frame,
      code: "UNSUPPORTED_SYNTAX",
      message:
        `The parameter "${echoIdentifier(name)}" binds an identifier, which cannot be used here. ` +
        "Write the table or column name directly in the query.",
      node,
    });
    return null;
  }
  if (!ctx.parameters.some((parameter) => parameter.name === name)) {
    ctx.parameters.push({ name, type: paramType });
  }
  return frame;
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

const SCALAR: FieldRule = { kind: "scalar" };

const SETTINGS_CLAUSE_MESSAGE =
  "A SETTINGS clause cannot be used here. Remove it — execution settings are fixed by the API.";

const REFUSE_SETTINGS: FieldRule = {
  kind: "refuse",
  code: "SETTINGS_CLAUSE",
  message: SETTINGS_CLAUSE_MESSAGE,
};
const REFUSE_OUTPUT: FieldRule = {
  kind: "refuse",
  code: "OUTPUT_CLAUSE",
  message: "FORMAT and INTO OUTFILE cannot be used here. The API decides how results are returned.",
};

/**
 * Every node kind the walk recognises, and every field each of them may carry. Read this table
 * as the policy: it is the complete statement of what a LangWatchQL query may contain. Nothing
 * outside it is reachable.
 */
const NODE_RULES: Readonly<Record<string, NodeRule>> = {
  // ---- query structure ----
  SelectWithUnionQuery: {
    enter: enterSelectWithUnionQuery,
    fields: {
      selects: { kind: "nodes" },
      // Both modes are read-only set operations, and the row policy applies to
      // each branch identically. Listed by value so a third mode fails closed.
      union_mode: { kind: "enum", values: ["UNION_ALL", "UNION_DISTINCT"] },
      settings: REFUSE_SETTINGS,
      format: REFUSE_OUTPUT,
      out_file: REFUSE_OUTPUT,
      outfile_truncate: REFUSE_OUTPUT,
      settings_before_format: REFUSE_OUTPUT,
    },
  },
  SelectQuery: {
    enter: enterSelectQuery,
    fields: {
      with: { kind: "nodes", clause: "with" },
      recursive_with: SCALAR,
      distinct: SCALAR,
      select: { kind: "custom", walk: walkProjection },
      from: { kind: "node", clause: "from" },
      prewhere: { kind: "node", clause: "filter" },
      where: { kind: "node", clause: "filter" },
      group_by: { kind: "nodes", clause: "group" },
      group_by_all: SCALAR,
      group_by_with_totals: SCALAR,
      group_by_with_rollup: SCALAR,
      group_by_with_cube: SCALAR,
      group_by_with_grouping_sets: SCALAR,
      having: { kind: "node", clause: "having" },
      window: { kind: "nodes", clause: "window" },
      qualify: { kind: "node", clause: "filter" },
      order_by: { kind: "nodes", clause: "order" },
      order_by_all: SCALAR,
      interpolate: { kind: "nodes", clause: "order" },
      limit_by: { kind: "custom", walk: walkLimitBy },
      limit: { kind: "node", clause: "limit" },
      offset: { kind: "node", clause: "limit" },
      limit_with_ties: SCALAR,
      settings: REFUSE_SETTINGS,
    },
  },
  Subquery: {
    enter: visitSubquery,
    fields: { query: { kind: "node" }, alias: SCALAR },
  },
  WithElement: {
    fields: {
      name: SCALAR,
      subquery: { kind: "node" },
      aliases: { kind: "node" },
    },
  },

  // ---- FROM ----
  TablesInSelectQuery: { fields: { children: { kind: "nodes" } } },
  TablesInSelectQueryElement: {
    fields: {
      table_expression: { kind: "node" },
      table_join: { kind: "node", clause: "join" },
      array_join: { kind: "node", clause: "from" },
    },
  },
  TableExpression: {
    fields: {
      database_and_table_name: { kind: "node" },
      table_function: {
        kind: "refuse",
        code: "TABLE_FUNCTION",
        message:
          "Table functions cannot be used here. Read from the analytics views listed by the schema endpoint.",
      },
      subquery: { kind: "node" },
      final: SCALAR,
      sample_size: { kind: "node" },
      sample_offset: { kind: "node" },
      column_aliases: { kind: "node" },
    },
  },
  TableIdentifier: {
    enter: visitTableIdentifier,
    fields: { name: SCALAR, database: SCALAR, alias: SCALAR },
  },
  TableJoin: {
    enter: enterTableJoin,
    fields: {
      // PASTE is absent deliberately: it joins by row position rather than by
      // key, which is not a shape the LangWatchQL schema's joins are defined for.
      kind: {
        kind: "enum",
        values: ["INNER", "LEFT", "RIGHT", "FULL", "CROSS", "COMMA"],
      },
      strictness: {
        kind: "enum",
        values: ["ANY", "ALL", "ASOF", "SEMI", "ANTI"],
      },
      locality: { kind: "enum", values: ["GLOBAL"] },
      using: { kind: "nodes", clause: "join" },
      on: { kind: "node", clause: "join" },
    },
  },
  ArrayJoin: {
    fields: {
      kind: { kind: "enum", values: ["INNER", "LEFT"] },
      expressions: { kind: "nodes", clause: "from" },
    },
  },
  SampleRatio: { fields: { numerator: SCALAR, denominator: SCALAR } },

  // ---- ordering, windows, grouping ----
  OrderByElement: {
    fields: {
      expression: { kind: "node" },
      direction: { kind: "enum", values: ["ASC", "DESC"] },
      collation: { kind: "node" },
      nulls_first: SCALAR,
      with_fill: SCALAR,
      fill_from: { kind: "node" },
      fill_to: { kind: "node" },
      fill_step: { kind: "node" },
      fill_staleness: { kind: "node" },
    },
  },
  InterpolateElement: {
    fields: {
      column: { kind: "custom", walk: walkInterpolatedColumn },
      expr: { kind: "node" },
    },
  },
  WindowListElement: {
    fields: { name: SCALAR, definition: { kind: "node", clause: "window" } },
  },
  WindowDefinition: {
    fields: {
      parent_window_name: SCALAR,
      partition_by: { kind: "nodes", clause: "window" },
      order_by: { kind: "nodes", clause: "window" },
      frame_type: { kind: "enum", values: ["ROWS", "RANGE", "GROUPS"] },
      frame_begin: { kind: "node", clause: "window" },
      frame_end: { kind: "node", clause: "window" },
    },
  },
  // Frame bounds are inline `{ type }` objects rather than named AST nodes,
  // but they reach the walk the same way and so need rules the same way.
  Unbounded: { fields: { preceding: SCALAR } },
  Current: { fields: { preceding: SCALAR } },
  Offset: { fields: { preceding: SCALAR, offset: { kind: "node" } } },

  // ---- expressions ----
  Identifier: {
    enter: visitIdentifier,
    fields: { name: SCALAR, name_parts: SCALAR, alias: SCALAR },
  },
  Literal: {
    fields: {
      value_type: SCALAR,
      value: SCALAR,
      alias: SCALAR,
      nonfinite: SCALAR,
    },
  },
  Function: {
    // On `enter` rather than as a rule for the `name` field, because a field
    // rule only fires when the field is present: a `Function` node that
    // arrived without a name would walk straight past a name check hung there.
    enter: visitFunction,
    fields: {
      name: SCALAR,
      arguments: { kind: "custom", walk: walkFunctionArguments },
      parameters: { kind: "nodes" },
      is_operator: SCALAR,
      is_lambda_function: SCALAR,
      is_window_function: SCALAR,
      // The other FunctionKind values (TABLE_ENGINE, CODEC, …) only occur in
      // DDL, which never reaches this walk; listing them would be listing
      // syntax we refuse at the statement.
      kind: {
        kind: "enum",
        values: ["LAMBDA_FUNCTION", "WINDOW_FUNCTION"],
      },
      window_definition: { kind: "node", clause: "window" },
      window_name: SCALAR,
      nulls_action: {
        kind: "enum",
        values: ["RESPECT NULLS", "IGNORE NULLS"],
      },
      alias: SCALAR,
      no_parens: SCALAR,
    },
  },
  QueryParameter: {
    enter: visitQueryParameter,
    fields: { name: SCALAR, param_type: SCALAR, alias: SCALAR },
  },
  ExpressionList: { fields: { children: { kind: "nodes" } } },

  // ---- column sets ----
  Asterisk: {
    enter: visitColumnSet,
    fields: {
      transformers: { kind: "nodes" },
      expression: { kind: "node" },
    },
  },
  QualifiedAsterisk: {
    enter: visitColumnSet,
    fields: {
      qualifier: { kind: "identifierRef" },
      columns: { kind: "nodes" },
      transformers: { kind: "nodes" },
    },
  },
  ColumnsRegexpMatcher: {
    enter: visitColumnSet,
    fields: { pattern: SCALAR, transformers: { kind: "nodes" } },
  },
  ColumnsListMatcher: {
    enter: visitColumnListMatcher,
    fields: { columns: { kind: "nodes" }, transformers: { kind: "nodes" } },
  },
  QualifiedColumnsRegexpMatcher: {
    enter: visitColumnSet,
    fields: {
      pattern: SCALAR,
      qualifier: { kind: "identifierRef" },
      transformers: { kind: "node" },
    },
  },
  QualifiedColumnsListMatcher: {
    enter: visitColumnListMatcher,
    fields: {
      qualifier: { kind: "identifierRef" },
      columns: { kind: "nodes" },
      transformers: { kind: "node" },
    },
  },
  ColumnsTransformerList: { fields: { children: { kind: "nodes" } } },
  ColumnsApplyTransformer: {
    fields: {
      func_name: { kind: "custom", walk: walkApplyFunctionName },
      parameters: { kind: "node" },
      lambda: { kind: "node" },
      lambda_arg: SCALAR,
    },
  },
  ColumnsExceptTransformer: {
    fields: {
      is_strict: SCALAR,
      columns: { kind: "nodes" },
      pattern: SCALAR,
    },
  },
  ColumnsReplaceTransformer: {
    fields: { is_strict: SCALAR, replacements: { kind: "nodes" } },
  },
  "ColumnsReplaceTransformer::Replacement": {
    // `name` is the output column the replacement is bound to, not a read of
    // the underlying field, so the content gate does not apply to it.
    fields: { name: SCALAR, expression: { kind: "node" } },
  },

  // ---- recognised so the refusal is specific ----
  Settings: {
    // Listed rather than left to the fallthrough so that a smuggled SETTINGS
    // clause says so, wherever it appears — including inside a function call,
    // where ClickHouse accepts `f(x SETTINGS k = v)`.
    enter: ({ node, frame, ctx }) => {
      report({
        ctx,
        frame,
        code: "SETTINGS_CLAUSE",
        message: SETTINGS_CLAUSE_MESSAGE,
        node,
      });
      return null;
    },
    fields: {},
  },
};
