import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";
import { z } from "zod";

import { operationSchema } from "../model/operation-schema.ts";
import type { Operation } from "../model/operation.ts";

/** The two published OpenAPI documents, relative to the docs root, in lookup order. */
export const SPEC_FILES = [
  "api-reference/openapiLangWatch.json",
  "api-reference/openapi-evals.json",
] as const;
const VERBS = ["get", "post", "put", "patch", "delete"] as const;
const PREFIX = "virtual:docs-op/";
const LIST_ID = "virtual:docs-operations";

type Json = z.infer<ReturnType<typeof z.json>>;
type JsonObject = { [key: string]: Json };

/* Structural reads only: z.object reorders keys, so every value that is
   published as-is (schemas, examples, security schemes) stays z.json(),
   which keeps authored key order for the Markdown export and page data. */
const json = z.json();
const stringList = z.array(z.string());
const documentShape = z.looseObject({
  paths: z.record(z.string(), z.record(z.string(), json)),
  servers: z.array(z.looseObject({ url: z.string() })).optional(),
  security: z.array(z.record(z.string(), stringList)).optional(),
  components: z
    .looseObject({ securitySchemes: z.record(z.string(), z.record(z.string(), json)).optional() })
    .optional(),
});
const mediaShape = z.looseObject({
  schema: json.optional(),
  example: json.optional(),
  examples: z.record(z.string(), z.looseObject({ value: json.optional() })).optional(),
});
const contentShape = z.record(z.string(), mediaShape).optional();
const parameterShape = z.looseObject({
  in: z.string(),
  name: z.string(),
  required: z.boolean().optional(),
  deprecated: z.boolean().optional(),
  description: z.string().optional(),
  schema: json.optional(),
});
const parametersShape = z.array(parameterShape);
const operationShape = z.looseObject({
  summary: z.string().optional(),
  description: z.string().optional(),
  operationId: z.string().optional(),
  deprecated: z.boolean().optional(),
  servers: z.array(z.looseObject({ url: z.string() })).optional(),
  security: z.array(z.record(z.string(), stringList)).optional(),
  parameters: z.array(parameterShape).optional(),
  requestBody: z
    .looseObject({
      required: z.boolean().optional(),
      description: z.string().optional(),
      content: contentShape,
    })
    .optional(),
  responses: z
    .record(
      z.string(),
      z.looseObject({ description: z.string().optional(), content: contentShape }),
    )
    .optional(),
});
/* Raw (not inlined) operations, for navigation titles: parameters may still be $refs. */
const summaryShape = z.looseObject({
  summary: z.string().optional(),
  description: z.string().optional(),
  operationId: z.string().optional(),
  responses: json.optional(),
});
export type OperationSummary = z.infer<typeof summaryShape>;

type Spec = { root: Json; document: z.infer<typeof documentShape> };
const specCache = new Map<string, { revision: string; spec: Spec }>();

function isObject(node: Json | undefined): node is JsonObject {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

/** A file's revision: its change time moves on every write, even one that keeps the mtime. */
function revisionOf({ filename }: { filename: string }) {
  const stats = statSync(filename, { bigint: true });
  return `${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
}

/** Reads one spec, reparsing only when the file changed (dev watches both documents). */
function loadSpec({ docsRoot, file }: { docsRoot: string; file: string }): Spec {
  const filename = path.join(docsRoot, file);
  const revision = revisionOf({ filename });
  const cached = specCache.get(filename);
  if (cached?.revision === revision) return cached.spec;
  const root = json.parse(JSON.parse(readFileSync(filename, "utf8")));
  const spec = { root, document: documentShape.parse(root) };
  specCache.set(filename, { revision, spec });
  return spec;
}

/** `openapi:` frontmatter is `<METHOD> <path>` or a bare path, optionally quoted. */
export function parseOpenapiRef({ openapi }: { openapi: string }) {
  const match = /^(?:(\w+)\s+)?(\S+)$/.exec(openapi.trim().replace(/^["']|["']$/g, ""));
  const [, method = "", route] = match ?? [];
  return route === undefined ? null : { method, route };
}

function lookupRef({ root, ref }: { root: Json; ref: string }) {
  let node: Json | undefined = root;
  for (const key of ref.replace(/^#\//, "").split("/")) {
    node = isObject(node) ? node[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
  }
  return node;
}

/** Inlines every `$ref`, marks cycles as `$recursive` and drops `x-` extensions. */
function deref({ root, node, seen }: { root: Json; node: Json; seen: string[] }): Json {
  if (Array.isArray(node)) return node.map((item) => deref({ root, node: item, seen }));
  if (!isObject(node)) return node;
  const ref = node.$ref;
  if (typeof ref === "string") {
    if (seen.includes(ref)) return { $recursive: ref.split("/").pop() ?? "" };
    return deref({ root, node: lookupRef({ root, ref }) ?? null, seen: [...seen, ref] });
  }
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("x-")) out[key] = deref({ root, node: value, seen });
  }
  return out;
}

function splitServer({ url }: { url: string }) {
  const parsed = new URL(url);
  return { origin: parsed.origin, basePath: parsed.pathname.replace(/\/$/, "") };
}

function contentsOf({ content }: { content: z.infer<typeof contentShape> }) {
  return Object.entries(content ?? {}).map(([type, value]) => ({
    type,
    schema: value.schema ?? null,
    example: value.example ?? Object.values(value.examples ?? {})[0]?.value,
  }));
}

/** Checked against the operation model; the resolved value is kept so key order is preserved. */
function isOperation(value: unknown): value is Operation {
  return z.validate(operationSchema, value);
}

/** Resolves `openapi: <METHOD> <path>` frontmatter to one self-contained operation. */
export function resolveOperation({
  docsRoot,
  openapi,
}: {
  docsRoot: string;
  openapi: string;
}): Operation | null {
  const ref = parseOpenapiRef({ openapi });
  if (!ref) return null;
  for (const file of SPEC_FILES) {
    const { root, document } = loadSpec({ docsRoot, file });
    const methods = document.paths[ref.route];
    const verb = ref.method ? ref.method.toLowerCase() : Object.keys(methods ?? {})[0];
    const raw = verb ? methods?.[verb] : undefined;
    if (!methods || !verb || raw === undefined) continue;
    const operation = operationShape.parse(deref({ root, node: raw, seen: [] }));
    const shared = parametersShape.parse(deref({ root, node: methods.parameters ?? [], seen: [] }));
    const { origin, basePath } = splitServer({
      url: (operation.servers ?? document.servers)?.[0]?.url ?? "https://app.langwatch.ai",
    });
    const requirements = operation.security ?? document.security ?? [];
    const schemes = [
      ...new Set(requirements.flatMap((requirement) => Object.keys(requirement))),
    ].map((name) => ({ id: name, ...document.components?.securitySchemes?.[name] }));
    const resolved = {
      method: verb.toUpperCase(),
      path: `${basePath}${ref.route}`,
      origin,
      summary: operation.summary ?? "",
      description: operation.description ?? "",
      deprecated: Boolean(operation.deprecated),
      schemes,
      parameters: [...shared, ...(operation.parameters ?? [])].map((param) => ({
        in: param.in,
        name: param.name,
        required: Boolean(param.required),
        deprecated: Boolean(param.deprecated) || /^deprecated\b/i.test(param.description ?? ""),
        description: param.description ?? "",
        schema: param.schema ?? {},
      })),
      body: operation.requestBody
        ? {
            required: Boolean(operation.requestBody.required),
            description: operation.requestBody.description ?? "",
            contents: contentsOf({ content: operation.requestBody.content }),
          }
        : null,
      responses: Object.entries(operation.responses ?? {}).map(([status, response]) => ({
        status,
        description: response.description ?? "",
        contents: contentsOf({ content: response.content }),
      })),
    };
    if (!isOperation(resolved))
      throw new Error(`OpenAPI operation ${openapi} does not match the operation model`);
    return resolved;
  }
  return null;
}

function indexRoute({
  index,
  route,
  methods,
}: {
  index: Map<string, OperationSummary>;
  route: string;
  methods: Record<string, Json>;
}) {
  for (const verb of VERBS) {
    const parsed = summaryShape.safeParse(methods[verb]);
    if (!parsed.success || !parsed.data.responses) continue;
    index.set(`${verb.toUpperCase()} ${route}`, parsed.data);
    if (!index.has(route)) index.set(route, parsed.data);
  }
}

const indexCache = new Map<string, { revisions: string; index: Map<string, OperationSummary> }>();

/** Operations by `METHOD /route` and the first method by bare route, for navigation titles. */
export function operationIndex({ docsRoot }: { docsRoot: string }) {
  const revisions = SPEC_FILES.map((file) =>
    revisionOf({ filename: path.join(docsRoot, file) }),
  ).join();
  const cached = indexCache.get(docsRoot);
  if (cached?.revisions === revisions) return cached.index;
  const index = new Map<string, OperationSummary>();
  for (const file of SPEC_FILES) {
    for (const [route, methods] of Object.entries(loadSpec({ docsRoot, file }).document.paths))
      indexRoute({ index, route, methods });
  }
  indexCache.set(docsRoot, { revisions, index });
  return index;
}

/** Serves `virtual:docs-op/<slug>` (an operation) and `virtual:docs-operations` (loaders). */
export function docsOpenapiPlugin({
  docsRoot,
  openapiBySlug,
}: {
  docsRoot: string;
  openapiBySlug: () => Record<string, string>;
}): Plugin {
  return {
    name: "docs-openapi",
    resolveId: {
      filter: { id: /^virtual:docs-op(?:\/|erations$)/ },
      handler: (id) => `\0${id}`,
    },
    load: {
      filter: { id: /^\0virtual:docs-op(?:\/|erations$)/ },
      handler(id) {
        if (id === `\0${LIST_ID}`) {
          const entries = Object.keys(openapiBySlug()).map(
            (slug) => `${JSON.stringify(slug)}: () => import(${JSON.stringify(PREFIX + slug)})`,
          );
          return `export default {${entries.join(",")}};`;
        }
        const slug = id.slice(PREFIX.length + 1);
        const openapi = openapiBySlug()[slug];
        if (openapi === undefined) throw new Error(`No OpenAPI reference for ${slug}`);
        const operation = resolveOperation({ docsRoot, openapi });
        return `export default ${JSON.stringify(operation)};`;
      },
    },
  };
}
