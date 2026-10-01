// Where a request-deduplication token is written, and whether what is written
// there was minted on the spot. Shared by `idempotency-key-is-stable`, which
// reports such a mint, and `id-generation-origin`, which stops claiming these
// values: an idempotency key is not an entity id and no ksuid fixes it.

/** `idempotencyKey`, `idempotency_key` and the `Idempotency-Key` header, in any case. */
function isIdempotencyKeyName(name) {
  return (
    typeof name === "string" && name.replaceAll(/[-_]/g, "").toLowerCase() === "idempotencykey"
  );
}

/** `headers.set("Idempotency-Key", value)` and `.append(...)` write a header, not a field. */
const HEADER_WRITES = new Set(["set", "append"]);

/** Calls that answer differently every time they are evaluated. */
const MINTING_CALLS = new Set(["randomUUID", "nanoid", "uuid", "uuidv4", "v4", "ulid"]);

/** `Object.method()` forms whose freshness comes from the object, not the name. */
const MINTING_MEMBERS = new Map([
  ["Math.random", "Math.random()"],
  ["Date.now", "Date.now()"],
]);

/**
 * Expression types a minted value can sit inside on its way to the property it
 * is written to. `ObjectExpression` is deliberately absent: a sibling property
 * must not inherit the exemption.
 */
const VALUE_WRAPPERS = new Set([
  "ArrowFunctionExpression",
  "AssignmentExpression",
  "AwaitExpression",
  "BinaryExpression",
  "CallExpression",
  "ConditionalExpression",
  "FunctionExpression",
  "LogicalExpression",
  "MemberExpression",
  "Property",
  "TemplateLiteral",
  "TSAsExpression",
  "TSNonNullExpression",
  "VariableDeclarator",
]);

const ANCESTOR_BUDGET = 8;

function propertyKeyName(node) {
  if (node.computed) return undefined;
  if (node.key?.type === "Identifier") return node.key.name;
  if (node.key?.type === "Literal" && typeof node.key.value === "string") return node.key.value;

  return undefined;
}

/** The field an assignment writes to, for `x.field = value`. */
export function assignedFieldNameOf(node) {
  const left = node?.left;
  if (node?.type !== "AssignmentExpression") return undefined;
  if (left?.type !== "MemberExpression" || left.computed) return undefined;

  return left.property?.type === "Identifier" ? left.property.name : undefined;
}

/**
 * The idempotency-key name a declaration binds, directly or through the
 * destructure a `useState` binding arrives as.
 */
function boundIdempotencyKeyName(id) {
  if (id?.type === "Identifier") return isIdempotencyKeyName(id.name) ? id.name : undefined;

  const names =
    id?.type === "ArrayPattern"
      ? (id.elements ?? []).map((element) =>
          element?.type === "Identifier" ? element.name : undefined,
        )
      : (id?.properties ?? []).map(propertyKeyName);

  return names.find(isIdempotencyKeyName);
}

function headerWriteOf(node) {
  const { callee } = node;
  if (callee?.type !== "MemberExpression" || callee.computed) return undefined;
  if (!HEADER_WRITES.has(callee.property?.name)) return undefined;
  const [key, value] = node.arguments ?? [];
  if (key?.type !== "Literal" || !isIdempotencyKeyName(key.value)) return undefined;

  return { name: key.value, value };
}

function targetName(node) {
  if (node?.type === "Property") return propertyKeyName(node);
  if (node?.type === "VariableDeclarator") return boundIdempotencyKeyName(node.id);
  if (node?.type === "AssignmentExpression") return assignedFieldNameOf(node);

  return undefined;
}

const TARGET_VALUE = {
  AssignmentExpression: "right",
  Property: "value",
  VariableDeclarator: "init",
};

/**
 * The value written to an idempotency key and the name it is written under: an
 * object property or header, a variable, a field, or a `headers.set` call.
 * @returns {{ name: string, value: object | undefined } | undefined}
 */
export function idempotencyKeyTargetOf(node) {
  if (node?.type === "CallExpression") return headerWriteOf(node);
  const name = targetName(node);
  if (!isIdempotencyKeyName(name)) return undefined;

  return { name, value: node[TARGET_VALUE[node.type]] };
}

function memberPath(callee) {
  if (callee?.type !== "MemberExpression" || callee.computed) return undefined;
  if (callee.object?.type !== "Identifier" || callee.property?.type !== "Identifier") {
    return undefined;
  }

  return `${callee.object.name}.${callee.property.name}`;
}

function calleeName(callee) {
  if (callee?.type === "Identifier") return callee.name;
  if (callee?.type === "MemberExpression" && !callee.computed) {
    return callee.property?.type === "Identifier" ? callee.property.name : undefined;
  }

  return undefined;
}

function mintedCallSource(expression) {
  const path = memberPath(expression.callee);
  const member = path === undefined ? undefined : MINTING_MEMBERS.get(path);
  if (member) return member;

  const name = calleeName(expression.callee);
  if (name && MINTING_CALLS.has(name)) return path ? `${path}()` : `${name}()`;

  // `Math.random().toString(36).slice(2)` is still a mint; the chain over it
  // only reshapes the value.
  return expression.callee?.type === "MemberExpression"
    ? mintedSourceOf(expression.callee.object)
    : undefined;
}

/**
 * The mint inside an expression as written, or nothing when it names a value
 * bound elsewhere. A `??` fallback is nothing on purpose - the caller
 * supplies the key and the fallback is the unkeyed path.
 * @returns {string | undefined}
 */
export function mintedSourceOf(expression) {
  if (!expression) return undefined;

  if (expression.type === "TemplateLiteral") {
    for (const part of expression.expressions) {
      const minted = mintedSourceOf(part);
      if (minted) return minted;
    }

    return undefined;
  }

  return expression.type === "CallExpression" ? mintedCallSource(expression) : undefined;
}

/**
 * Whether `node` sits inside the value of an idempotency key, walking out
 * through the wrappers a value can be nested in and no further.
 */
export function withinAnIdempotencyKey(node) {
  let current = node.parent;
  for (let step = 0; current && step < ANCESTOR_BUDGET; step += 1) {
    if (idempotencyKeyTargetOf(current)) return true;
    if (!VALUE_WRAPPERS.has(current.type)) return false;
    current = current.parent;
  }

  return false;
}
