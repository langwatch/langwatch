/**
 * Keeps a defaulted field required on the responses that always return it.
 *
 * ── THE DIFFERENCE ─────────────────────────────────────────────────────────
 *
 * hono-openapi v0.4 converted zod through `zod-openapi`, which reads a schema
 * as its OUTPUT type unless told otherwise — and its validator told it
 * otherwise, passing `schemaType: "input"` for request bodies only. So requests
 * and responses were read in opposite directions, deliberately.
 *
 * v1 converts through Standard Schema, and zod 3 exposes no input/output split
 * across that boundary, so `@standard-community/standard-openapi` reads every
 * schema as its input. Requests are unaffected — that was already the reading
 * they got. Responses lose the distinction:
 *
 *     z.object({ tags: z.array(z.string()).default([]) })
 *       as input    required: []          ← a caller may omit it
 *       as output   required: ["tags"]    ← the server always sends it
 *
 * Measured on this document: 30 entries across the 8 prompts response schemas
 * — `messages`, `inputs`, `tags`, `parameters` — all of which the API always
 * returns. `openapi-python-client` turns a non-required field into `Unset`, so
 * shipping this would have loosened those attributes' types for every Python
 * SDK user, silently and for no reason anyone chose.
 *
 * ── WHY HERE AND NOT IN THE CONVERTER ──────────────────────────────────────
 *
 * `loadVendor` can replace the zod converter, but its hook is handed only the
 * schema and a components bag — not the caller's options, and not whether this
 * is a request or a response. One global direction is the only thing it can
 * express, and neither direction is right for both: reading requests as output
 * makes `createSchema` fail outright on a transform it cannot invert (measured:
 * `providersAllowed` in the governance request body).
 *
 * The document, unlike the converter, knows perfectly well which schemas are
 * responses. So the correction is applied there, where the distinction exists.
 *
 * A property carrying `default` is one the serialiser always fills in, which is
 * exactly the rule v0.4's output reading encoded.
 */

interface JsonSchemaLike {
  type?: string;
  default?: unknown;
  required?: string[];
  properties?: Record<string, JsonSchemaLike | undefined>;
  items?: JsonSchemaLike;
  allOf?: JsonSchemaLike[];
  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
}

/** The nested schemas a composite one is built from. */
function subSchemasOf(schema: JsonSchemaLike): (JsonSchemaLike | undefined)[] {
  return [
    ...(schema.allOf ?? []),
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
    schema.items,
  ];
}

/**
 * Names the properties this schema always serialises, having recursed first.
 *
 * The recursion happens here rather than in the caller so that a property is
 * visited exactly once, whether or not it turns out to carry a default.
 */
function defaultedPropertyNames(schema: JsonSchemaLike): string[] {
  const defaulted: string[] = [];

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    requireDefaultedProperties(property);
    if (property && "default" in property) defaulted.push(name);
  }

  return defaulted;
}

/** Adds every defaulted property to `required`, depth-first. */
function requireDefaultedProperties(schema: JsonSchemaLike | undefined): void {
  if (!schema || typeof schema !== "object") return;

  subSchemasOf(schema).forEach(requireDefaultedProperties);

  const defaulted = defaultedPropertyNames(schema);
  if (defaulted.length === 0) return;

  // Existing entries keep their order so the document stays diff-stable; the
  // newly required ones follow in property order.
  const already = schema.required ?? [];
  schema.required = [
    ...already,
    ...defaulted.filter((name) => !already.includes(name)),
  ];
}

const OPENAPI_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

interface OperationLike {
  responses?: Record<
    string,
    | { content?: Record<string, { schema?: JsonSchemaLike } | undefined> }
    | undefined
  >;
}

/**
 * Just enough of a generated document to walk it.
 *
 * `paths` is `Record<string, unknown>` rather than a map of operations because
 * a hono-openapi path item carries `servers` and `parameters` alongside its
 * methods. Naming only the methods would make the real type fail to match, and
 * the generic would silently widen to this interface — losing the caller's
 * concrete type on the way out.
 */
interface SpecLike {
  paths?: Record<string, unknown>;
}

/**
 * Reads every response schema in a generated spec as its output type.
 *
 * Request bodies and parameters are deliberately untouched: their input reading
 * is both correct and unchanged by the upgrade.
 */
/** Every response body schema one operation can answer with. */
function requireInOperation(operation: OperationLike | undefined): void {
  for (const response of Object.values(operation?.responses ?? {})) {
    for (const media of Object.values(response?.content ?? {})) {
      requireDefaultedProperties(media?.schema);
    }
  }
}

/** Every operation hanging off one path. */
function requireInPathItem(rawItem: unknown): void {
  const item = rawItem as Record<string, OperationLike | undefined> | undefined;
  if (!item) return;

  for (const method of OPENAPI_METHODS) {
    requireInOperation(item[method]);
  }
}

export function requireDefaultedResponseFields<T extends SpecLike>(spec: T): T {
  for (const rawItem of Object.values(spec.paths ?? {})) {
    requireInPathItem(rawItem);
  }

  return spec;
}
