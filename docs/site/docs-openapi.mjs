import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const SPEC_FILES = ["api-reference/openapiLangWatch.json", "api-reference/openapi-evals.json"];
const PREFIX = "virtual:docs-op/";
const LIST_ID = "virtual:docs-operations";
const specCache = new Map();

function loadSpec({ docsRoot, file }) {
  const filename = path.join(docsRoot, file);
  const revision = statSync(filename).mtimeMs;
  const cached = specCache.get(filename);
  if (cached?.revision === revision) return cached.spec;
  const spec = JSON.parse(readFileSync(filename, "utf8"));
  specCache.set(filename, { revision, spec });
  return spec;
}

function lookupRef({ spec, ref }) {
  return ref
    .replace(/^#\//, "")
    .split("/")
    .reduce((node, key) => node?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
}

function deref({ spec, node, seen }) {
  if (Array.isArray(node)) return node.map((item) => deref({ spec, node: item, seen }));
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    if (seen.includes(node.$ref)) return { $recursive: node.$ref.split("/").pop() };
    return deref({ spec, node: lookupRef({ spec, ref: node.$ref }), seen: [...seen, node.$ref] });
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("x-")) continue;
    out[key] = deref({ spec, node: value, seen });
  }
  return out;
}

function splitServer({ url }) {
  const parsed = new URL(url);
  return { origin: parsed.origin, basePath: parsed.pathname.replace(/\/$/, "") };
}

function contentsOf({ content }) {
  return Object.entries(content ?? {}).map(([type, value]) => ({
    type,
    schema: value.schema ?? null,
    example: value.example ?? Object.values(value.examples ?? {})[0]?.value,
  }));
}

/** Resolves `openapi: <METHOD> <path>` frontmatter to one self-contained operation. */
export function resolveOperation({ docsRoot, openapi }) {
  const match = /^(?:(\w+)\s+)?(\S+)$/.exec(openapi.trim().replace(/^["']|["']$/g, ""));
  if (!match) return null;
  const [, method, route] = match;
  for (const file of SPEC_FILES) {
    const spec = loadSpec({ docsRoot, file });
    const methods = spec.paths[route];
    const verb = method ? method.toLowerCase() : Object.keys(methods ?? {})[0];
    const raw = methods?.[verb];
    if (!raw) continue;
    const operation = deref({ spec, node: raw, seen: [] });
    const shared = deref({ spec, node: methods.parameters ?? [], seen: [] });
    const { origin, basePath } = splitServer({
      url: (operation.servers ?? spec.servers)?.[0]?.url ?? "https://app.langwatch.ai",
    });
    const requirements = operation.security ?? spec.security ?? [];
    const schemes = [
      ...new Set(requirements.flatMap((requirement) => Object.keys(requirement))),
    ].map((name) => ({
      id: name,
      ...spec.components?.securitySchemes?.[name],
    }));
    return {
      method: verb.toUpperCase(),
      path: `${basePath}${route}`,
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
  }
  return null;
}

/** Serves `virtual:docs-op/<slug>` (one operation) and `virtual:docs-operations` (lazy loaders). */
export function docsOpenapiPlugin({ docsRoot, openapiBySlug }) {
  return {
    name: "docs-openapi",
    resolveId(id) {
      return id.startsWith(PREFIX) || id === LIST_ID ? `\0${id}` : null;
    },
    load(id) {
      if (id === `\0${LIST_ID}`) {
        const entries = Object.keys(openapiBySlug()).map(
          (slug) => `${JSON.stringify(slug)}: () => import(${JSON.stringify(PREFIX + slug)})`,
        );
        return `export default {${entries.join(",")}};`;
      }
      if (!id.startsWith(`\0${PREFIX}`)) return null;
      const slug = id.slice(PREFIX.length + 1);
      const operation = resolveOperation({ docsRoot, openapi: openapiBySlug()[slug] });
      return `export default ${JSON.stringify(operation)};`;
    },
  };
}
