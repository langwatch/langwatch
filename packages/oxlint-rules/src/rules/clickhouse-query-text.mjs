// The SQL a ClickHouse repository hands the client, read from the string and
// template literals that spell it. A template's `${identifier}` is inlined when
// it names a string constant in reach; anything else stays an opaque `${...}`.

import { walk } from "../ast.mjs";

const MAX_INLINE_DEPTH = 4;
const SQL_LINE_COMMENT = /--[^\n]*/g;
const OWN_FROM = /\bFROM\b/g;
const MASKED_FROM = "FR0M";
const SUBQUERY_HEAD = /\s*(?:SELECT|WITH)\b/iy;
const STARTS_WITH = /^\s*WITH\b/i;
const BARE_NAME = /^[A-Za-z_]\w*$/;
const PLACEHOLDER = /\$\{[^}]*\}/g;
const PLACEHOLDER_NOISE = /[^\w.$]/g;
const QUERY_SHAPE = /\bSELECT\b[\s\S]*\bFROM\b|\bALTER\s+TABLE\b[\s\S]*\b(?:DELETE|UPDATE)\b/;
const NAME = String.raw`(?:[A-Za-z_][\w.]*|\$\{[^}]*\}[\w.]*)(?:\$\{[^}]*\}[\w.]*)*`;
const TRIM_OPERAND = String.raw`(?<!\b(?:BOTH|LEADING|TRAILING)\s+'[^']*'\s*)`;
const SCOPE_OPENER = new RegExp(
  String.raw`${TRIM_OPERAND}\b(?:FROM|ALTER\s+TABLE)\s+(${NAME}|\()(\s*\()?`,
  "g",
);
const CTE_NAME = new RegExp(String.raw`(?<![\w.}])(${NAME})\s+AS\s*\(`, "g");

/** Whether the file is a ClickHouse repository in a module's process half. */
export function isClickHouseRepository(file) {
  return (
    file.role === "process" &&
    !file.isTest &&
    Boolean(file.sourcePath?.startsWith("repositories/clickhouse/"))
  );
}

function constInitOf(context, identifier) {
  let scope = context.sourceCode.getScope(identifier);
  while (scope && !scope.set.has(identifier.name)) scope = scope.upper;
  const definition = scope?.set.get(identifier.name)?.defs[0];
  const declarator = definition?.node;
  if (declarator?.type !== "VariableDeclarator") return void 0;
  if (declarator.parent?.kind !== "const") return void 0;

  return unwrapped(declarator.init);
}

function unwrapped(node) {
  let current = node;
  while (current?.type === "TSAsExpression" || current?.type === "TSSatisfiesExpression") {
    current = current.expression;
  }

  return current;
}

function expressionText(context, expression, depth) {
  const node = unwrapped(expression);
  if (node?.type === "Identifier" && depth < MAX_INLINE_DEPTH) {
    const init = constInitOf(context, node);
    const inlined = init && literalText(context, init, depth + 1);
    // An inlined query is checked where it is written, so its FROMs are masked here.
    if (typeof inlined === "string") return inlined.replace(OWN_FROM, MASKED_FROM);
  }

  return `\${${placeholderName(context, node)}}`;
}

function placeholderName(context, node) {
  if (node?.type === "Identifier" || node?.type === "MemberExpression") {
    return context.sourceCode.getText(node).replace(PLACEHOLDER_NOISE, "");
  }
  if (node?.type === "CallExpression") return `${placeholderName(context, node.callee)}\u2026`;

  return "\u2026";
}

function concatenationText(context, node, depth) {
  const left = literalText(context, node.left, depth) ?? expressionText(context, node.left, depth);
  const right =
    literalText(context, node.right, depth) ?? expressionText(context, node.right, depth);

  return left + right;
}

/** The text a string or template literal spells, or undefined for anything else. */
export function literalText(context, node, depth = 0) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (isConcatenation(node)) return concatenationText(context, node, depth);
  if (node?.type !== "TemplateLiteral") return void 0;

  let text = node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  node.expressions.forEach((expression, index) => {
    const quasi = node.quasis[index + 1].value;
    text += expressionText(context, expression, depth) + (quasi.cooked ?? quasi.raw);
  });

  return text;
}

function isConcatenation(node) {
  return node?.type === "BinaryExpression" && node.operator === "+";
}

function queryTextOf(context, node) {
  const text = literalText(context, node);
  if (text === void 0) return void 0;
  const stripped = text.replace(SQL_LINE_COMMENT, "");

  return QUERY_SHAPE.test(stripped) ? stripped : void 0;
}

/**
 * A visitor that hands `onQuery` every literal that reads like a query, with
 * its assembled text. A `+` chain is one query, reported at its outermost node.
 */
export function queryTextVisitor(context, onQuery) {
  const visit = (node) => {
    if (isConcatenation(node.parent)) return;
    const text = queryTextOf(context, node);
    if (text !== void 0) onQuery(node, text);
  };

  return {
    BinaryExpression: (node) => isConcatenation(node) && visit(node),
    Literal: visit,
    TemplateLiteral: visit,
  };
}

/** Per character, how many subqueries enclose it; a plain bracket does not count. */
function depthsOf(text) {
  const depths = new Int32Array(text.length + 1);
  const opened = [];
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === ")" && opened.pop()) depth--;
    depths[index] = depth;
    if (text[index] !== "(") continue;
    SUBQUERY_HEAD.lastIndex = index + 1;
    const subquery = SUBQUERY_HEAD.test(text);
    opened.push(subquery);
    if (subquery) depth++;
  }
  depths[text.length] = depth;

  return depths;
}

/** A name with every interpolation blanked, so `${a}_x` and `${b}_x` compare equal. */
function canonical(name) {
  return name.replace(PLACEHOLDER, "${}");
}

/** Every name the text defines as a common table expression (`name AS (`). */
export function cteNamesOf(text) {
  return [...text.matchAll(CTE_NAME)].map((match) => canonical(match[1]));
}

/** Every CTE name any literal in the file defines, for fragments that read one. */
export function cteNamesInFile(context) {
  const names = [];
  walk(context.sourceCode.ast, (node) => {
    if (node.type !== "Literal" && node.type !== "TemplateLiteral") return;
    const text = literalText(context, node);
    if (typeof text === "string") names.push(...cteNamesOf(text));
  });

  return names;
}

function bareNameArguments(call) {
  return call.arguments
    .filter((argument) => argument.type === "Literal")
    .map((argument) => String(argument.value))
    .filter((value) => BARE_NAME.test(value));
}

/** Names a `WITH` statement hands its CTE builders: `WITH ${cte("name")} SELECT … FROM name`. */
export function withArgumentsOf(node) {
  if (node.type !== "TemplateLiteral") return [];
  const head = node.quasis[0].value.raw;
  if (!STARTS_WITH.test(head)) return [];
  const names = [];
  for (const expression of node.expressions) {
    walk(expression, (child) => {
      if (child.type === "CallExpression") names.push(...bareNameArguments(child));
    });
  }

  return names;
}

function scopeEnd(depths, openers, opener) {
  const depth = depths[opener.index];
  const next = openers.find((other) => other.index > opener.index && depths[other.index] === depth);
  let end = next ? next.index : depths.length - 1;
  for (let index = opener.index; index < end; index++) {
    if (depths[index] < depth) end = index;
  }

  return end;
}

/**
 * Every table the query reads or mutates that is not a known CTE, with its own
 * scope: from the table to the next table at the same depth or its subquery's end.
 */
export function tableScopesOf(text, knownCtes) {
  const depths = depthsOf(text);
  const ctes = new Set([...knownCtes, ...cteNamesOf(text)]);
  const openers = [...text.matchAll(SCOPE_OPENER)];

  return openers
    .filter((opener) => opener[1] !== "(" && !opener[2] && !ctes.has(canonical(opener[1])))
    .map((opener) => ({
      depth: depths[opener.index],
      depths,
      end: scopeEnd(depths, openers, opener),
      start: opener.index,
      table: opener[1],
    }));
}
