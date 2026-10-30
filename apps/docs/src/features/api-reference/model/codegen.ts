import type { ExampleLanguage, Operation, Schema } from "./operation.ts";

export type RequestState = { values: Record<string, string>; body: string };

const KEY_ENV = "LANGWATCH_API_KEY";

export function paramKey({ location, name }: { location: string; name: string }) {
  return `${location}:${name}`;
}

function mergeExampleSchema({ schema }: { schema: Schema }): Schema {
  if (!schema.allOf) return schema;
  const parts = schema.allOf.map((part) => mergeExampleSchema({ schema: part }));
  return {
    ...schema,
    type: "object",
    properties: Object.assign({}, ...parts.map((part) => part.properties ?? {}), schema.properties),
    required: [...parts.flatMap((part) => part.required ?? []), ...(schema.required ?? [])],
  };
}

/** A small example value for a schema, used to seed the body editor and response examples. */
export function exampleFromSchema({
  schema,
  depth = 0,
}: {
  schema: Schema | null | undefined;
  depth?: number;
}): unknown {
  if (!schema || depth > 5) return null;
  if (schema.example !== void 0) return schema.example;
  if (schema.const !== void 0) return schema.const;
  if (schema.default !== void 0) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const merged = mergeExampleSchema({ schema });
  const branch = merged.oneOf?.[0] ?? merged.anyOf?.[0];
  if (branch) return exampleFromSchema({ schema: branch, depth: depth + 1 });
  const type = Array.isArray(merged.type)
    ? merged.type.find((entry) => entry !== "null")
    : merged.type;
  if (type === "object" || merged.properties) return objectExample({ schema: merged, depth });
  if (type === "array") return [exampleFromSchema({ schema: merged.items, depth: depth + 1 })];
  return primitiveExample({ schema: merged, type });
}

function objectExample({ schema, depth }: { schema: Schema; depth: number }) {
  const result: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    result[name] = exampleFromSchema({ schema: child, depth: depth + 1 });
  }
  return result;
}

function primitiveExample({ schema, type }: { schema: Schema; type?: string }) {
  if (type === "string") return schema.format === "date-time" ? "2026-01-01T00:00:00Z" : "string";
  if (type === "integer" || type === "number") return schema.minimum ?? 0;
  if (type === "boolean") return false;
  return null;
}

function authHeader({
  operation,
}: {
  operation: Operation;
}): { name: string; value: string } | null {
  const scheme = operation.schemes[0];
  if (!scheme) return null;
  if (scheme.type === "apiKey" && scheme.in === "header")
    return { name: scheme.name ?? "X-Auth-Token", value: "$KEY" };
  return { name: "Authorization", value: "Bearer $KEY" };
}

function resolved({ operation, state }: { operation: Operation; state: RequestState }) {
  let path = operation.path;
  const query: [string, string][] = [];
  const headers: [string, string][] = [];
  for (const param of operation.parameters) {
    const value = state.values[paramKey({ location: param.in, name: param.name })]?.trim() ?? "";
    if (param.in === "path")
      path = path.replace(`{${param.name}}`, encodeURIComponent(value) || `<${param.name}>`);
    else if (!value) continue;
    else if (param.in === "query") query.push([param.name, value]);
    else if (param.in === "header") headers.push([param.name, value]);
  }
  const search = query
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
  return { url: `${operation.origin}${path}${search ? `?${search}` : ""}`, query, headers };
}

function pythonLiteral({ value, indent = 0 }: { value: unknown; indent?: number }): string {
  const pad = " ".repeat(indent + 4);
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value))
    return value.length === 0
      ? "[]"
      : `[\n${value.map((item) => `${pad}${pythonLiteral({ value: item, indent: indent + 4 })}`).join(",\n")},\n${" ".repeat(indent)}]`;
  const entries = Object.entries(typeof value === "object" && value !== null ? value : {});
  return entries.length === 0
    ? "{}"
    : `{\n${entries.map(([key, item]) => `${pad}${JSON.stringify(key)}: ${pythonLiteral({ value: item, indent: indent + 4 })}`).join(",\n")},\n${" ".repeat(indent)}}`;
}

function parseBody({ text }: { text: string }): unknown {
  if (!text.trim()) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}

/** Display code for one language. The reader's key is always the LANGWATCH_API_KEY placeholder. */
export function generateExample({
  operation,
  state,
  language,
}: {
  operation: Operation;
  state: RequestState;
  language: ExampleLanguage;
}): string {
  const { url, headers } = resolved({ operation, state });
  const auth = authHeader({ operation });
  const body = operation.body ? parseBody({ text: state.body }) : void 0;
  const needsBody = Boolean(operation.body?.required && body === void 0);
  const method = operation.method;
  const allHeaders: [string, string][] = [...headers];
  if (body !== void 0 || needsBody) allHeaders.push(["Content-Type", "application/json"]);
  const request = { url, origin: operation.origin, method, auth, allHeaders, body, needsBody };
  if (language === "curl") return curlExample(request);
  if (language === "python") return pythonExample(request);
  return typescriptExample(request);
}

type ExampleRequest = {
  url: string;
  origin: string;
  method: string;
  auth: { name: string; value: string } | null;
  allHeaders: [string, string][];
  body: unknown;
  needsBody: boolean;
};

function curlExample({ url, method, auth, allHeaders, body, needsBody }: ExampleRequest) {
  const parts = [`curl --request ${method} \\`, `  --url ${shellQuote(url)} \\`];
  if (auth)
    parts.push(`  --header "${auth.name}: ${auth.value.replace("$KEY", `$${KEY_ENV}`)}" \\`);
  for (const [name, value] of allHeaders)
    parts.push(`  --header ${shellQuote(`${name}: ${value}`)} \\`);
  if (needsBody) parts.push(`  --data @payload.json \\`);
  if (body !== void 0) parts.push(`  --data ${shellQuote(JSON.stringify(body))} \\`);
  const last = parts.length - 1;
  parts[last] = parts.at(-1)?.replace(/ \\$/, "") ?? "";
  return parts.join("\n");
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
function pythonExample({ url, origin, method, auth, allHeaders, body, needsBody }: ExampleRequest) {
  const headerLines = [
    ...(auth
      ? [
          `    ${JSON.stringify(auth.name)}: ${auth.value.includes("Bearer") ? '"Bearer " + api_key' : "api_key"},`,
        ]
      : []),
    ...allHeaders.map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)},`),
  ];
  const lines = [
    "import os",
    "import requests",
    ...(needsBody ? ["import json"] : []),
    "",
    `origin = "${origin}"`,
    `path = "${url.slice(origin.length)}"`,
  ];
  if (auth) lines.push(`api_key = os.environ["${KEY_ENV}"]`);
  if (headerLines.length) lines.push("headers = {", ...headerLines, "}");
  if (needsBody)
    lines.push(
      "",
      "# Supply your request body in payload.json",
      'with open("payload.json") as file:',
      "    payload = json.load(file)",
    );
  if (body !== void 0) lines.push(`payload = ${pythonLiteral({ value: body })}`);
  lines.push(
    "",
    `response = requests.${method.toLowerCase()}(`,
    "    origin + path,",
    ...(headerLines.length ? ["    headers=headers,"] : []),
    ...(needsBody || body !== void 0 ? ["    json=payload,"] : []),
    ")",
    "print(response.json())",
  );
  return lines.join("\n");
}
function typescriptExample({ url, method, auth, allHeaders, body, needsBody }: ExampleRequest) {
  const headerLines = [
    ...(auth
      ? [
          `    ${JSON.stringify(auth.name)}: ${auth.value.includes("Bearer") ? `"Bearer " + process.env.${KEY_ENV}` : `process.env.${KEY_ENV}!`},`,
        ]
      : []),
    ...allHeaders.map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)},`),
  ];
  const lines = [
    ...(needsBody
      ? [
          'import { readFile } from "node:fs/promises";',
          "const payload = JSON.parse(",
          '  await readFile("payload.json", "utf8"),',
          ");",
          "",
        ]
      : []),
    `const url = "${url}";`,
    `const response = await fetch(url, {`,
    `  method: "${method}",`,
  ];
  if (headerLines.length) lines.push("  headers: {", ...headerLines, "  },");
  if (needsBody) lines.push("  body: JSON.stringify(payload),");
  if (body !== void 0)
    lines.push(
      `  body: JSON.stringify(${JSON.stringify(body, null, 2).split("\n").join("\n  ")}),`,
    );
  lines.push("});", "const data = await response.json();");
  return lines.join("\n");
}

/** The live request: the entered key goes only into this call. */
export function liveRequest({
  operation,
  state,
  key,
}: {
  operation: Operation;
  state: RequestState;
  key: string;
}) {
  const { url, headers } = resolved({ operation, state });
  const auth = authHeader({ operation });
  const init: Record<string, string> = Object.fromEntries(headers);
  if (auth && key) init[auth.name] = auth.value.replace("$KEY", key);
  const body = operation.body && state.body.trim() ? state.body : void 0;
  if (body !== void 0) init["Content-Type"] = "application/json";
  return { url, headers: init, body };
}

/** The editable JSON body the playground starts from; empty when the operation has none. */
export function initialBodyOf({ operation }: { operation: Operation }): string {
  const content = operation.body?.contents.find((entry) => entry.type.includes("json"));
  if (!content) return "";
  const example = content.example ?? exampleFromSchema({ schema: content.schema });
  const text = JSON.stringify(example, null, 2);
  return text === "{}" || text === "null" ? "" : text;
}
