import { defineRule } from "../define-rule.mjs";
import { createZodSchemaResolver, memberName } from "./zod-schema-origin.mjs";

const GENERATED = /(?:^|\/)(?:generated|dist|node_modules)\/|(?:\.generated|\.d)\.[cm]?[jt]sx?$/;

const CONSTRUCTORS = new Set([
  "array",
  "discriminatedUnion",
  "intersection",
  "looseObject",
  "looseRecord",
  "map",
  "object",
  "partialRecord",
  "record",
  "set",
  "strictObject",
  "tuple",
  "union",
]);
const SCHEMA_METHODS = new Set([
  "and",
  "array",
  "catchall",
  "extend",
  "merge",
  "nullable",
  "nullish",
  "omit",
  "optional",
  "or",
  "partial",
  "passthrough",
  "pick",
  "refine",
  "required",
  "safeExtend",
  "strict",
  "superRefine",
  "transform",
]);
const ITERATION_METHODS = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "some",
]);
const LOOPS = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "WhileStatement",
]);
const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"]);

const PARSE_METHODS = new Set([
  "decode",
  "encode",
  "parse",
  "parseAsync",
  "safeDecode",
  "safeEncode",
  "safeParse",
  "safeParseAsync",
]);

/** The call `chain.method()` that extends `chain`, unless it parses. */
function nextSchemaCall(chain) {
  const member = chain.parent;
  if (member?.type !== "MemberExpression" || member.object !== chain) return void 0;
  if (PARSE_METHODS.has(memberName(member))) return void 0;
  const call = member.parent;
  return call?.type === "CallExpression" && call.callee === member ? call : void 0;
}

/** The schema chain `node` heads when a function returns it unparsed: a factory. */
function returnedSchema(node) {
  let chain = node;
  for (let next = nextSchemaCall(chain); next; next = nextSchemaCall(chain)) {
    chain = next;
  }

  const holder = chain.parent;
  const returned =
    (holder?.type === "ReturnStatement" && holder.argument === chain) ||
    (holder?.type === "ArrowFunctionExpression" && holder.body === chain);
  return returned ? chain : void 0;
}

/** How the report names a Zod construction, or undefined when `method` builds no schema. */
function constructionLabel(receiver, method) {
  if (receiver === "zod" && CONSTRUCTORS.has(method)) return `z.${method}()`;
  const schema = receiver === "object" || receiver === "refined";
  return schema && SCHEMA_METHODS.has(method) ? `.${method}()` : void 0;
}

function isSchemaSource(file) {
  return file.isProduction && !GENERATED.test(file.workspacePath);
}

function keyName(definition) {
  return definition.key?.name ?? definition.key?.value ?? "method";
}

function isIterationCallback(fn) {
  const call = fn.parent;
  return (
    call?.type === "CallExpression" &&
    call.arguments.includes(fn) &&
    ITERATION_METHODS.has(memberName(call.callee))
  );
}

function classMember(fn) {
  const owner = fn.parent;
  if (owner?.type === "MethodDefinition" && owner.kind !== "constructor") return owner;
  if (owner?.type === "PropertyDefinition" && !owner.static) return owner;
  return void 0;
}

/** Where a construction at `node` runs per call, or undefined when it runs once. */
function perCallSite(node) {
  let iterated = false;
  let child = node;
  for (let current = node.parent; current; child = current, current = current.parent) {
    if (current.type === "StaticBlock" || current.type === "Program") return void 0;
    if (LOOPS.has(current.type) && current.body === child) iterated = true;
    if (!FUNCTIONS.has(current.type)) continue;
    const member = classMember(current);
    if (iterated) return { messageId: "perIteration" };
    if (member) return { messageId: "perCall", method: keyName(member) };
    if (isIterationCallback(current)) iterated = true;
  }

  return void 0;
}

export const zodSchemaPerCallRule = defineRule({
  name: "zod-schema-per-call",
  kind: "problem",
  applies: isSchemaSource,
  messages: {
    perIteration: {
      what: "`{{call}}` builds a Zod schema on every iteration.",
      why: "Zod compiles a schema's parser on its first parse and caches it on that instance, so a schema built per row recompiles per row.",
      fix: "Move it to a module-level `const` beside the other schemas and parse with that constant here. Read the `contract` skill.",
    },
    perCall: {
      what: "`{{call}}` builds a Zod schema on every call to `{{method}}()`.",
      why: "Zod compiles a schema's parser on its first parse and caches it on that instance, so a schema built per call recompiles per call.",
      fix: "Move it to a module-level `const` beside the other schemas and parse with that constant here.",
    },
  },
  create(context, file) {
    let origin;
    let covered;
    return {
      CallExpression(node) {
        const method = memberName(node.callee);
        const candidate = CONSTRUCTORS.has(method) || SCHEMA_METHODS.has(method);
        if (!candidate) return;
        const inside = covered && node.range[0] >= covered[0] && node.range[1] <= covered[1];
        if (inside) return;
        const site = perCallSite(node);
        if (!site) return;
        origin ??= createZodSchemaResolver(context, file.filename);
        const call = constructionLabel(origin(node.callee.object), method);
        if (!call) return;
        const factory = returnedSchema(node);
        covered = (factory ?? node).range;
        if (factory) return;
        context.report({ node, messageId: site.messageId, data: { call, method: site.method } });
      },
    };
  },
});
