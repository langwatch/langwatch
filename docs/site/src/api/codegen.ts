import type { ExampleLanguage, Operation, Schema } from "./operation.ts";

export type RequestState = { values: Record<string, string>; body: string };

const KEY_ENV = "LANGWATCH_API_KEY";

export function paramKey({ location, name }: { location: string; name: string }) {
  return `${location}:${name}`;
}

/** A small example value for a schema, used to seed the body editor and response examples. */
export function exampleFromSchema({ schema, depth = 0 }: { schema: Schema | null | undefined; depth?: number }): unknown {
  if (!schema || depth > 5) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const merged: Schema = schema.allOf ? Object.assign({}, ...schema.allOf, schema) : schema;
  const branch = merged.oneOf?.[0] ?? merged.anyOf?.[0];
  if (branch) return exampleFromSchema({ schema: branch, depth: depth + 1 });
  const type = Array.isArray(merged.type) ? merged.type.find((entry) => entry !== "null") : merged.type;
  if (type === "object" || merged.properties) {
    const result: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(merged.properties ?? {})) {
      if (merged.required?.includes(name)) result[name] = exampleFromSchema({ schema: child, depth: depth + 1 });
    }
    return result;
  }
  if (type === "array") return [exampleFromSchema({ schema: merged.items, depth: depth + 1 })];
  if (type === "string") return merged.format === "date-time" ? "2026-01-01T00:00:00Z" : "string";
  if (type === "integer" || type === "number") return merged.minimum ?? 0;
  if (type === "boolean") return false;
  return null;
}

function authHeader({ operation }: { operation: Operation }): { name: string; value: string } | null {
  const scheme = operation.schemes[0];
  if (!scheme) return null;
  if (scheme.type === "apiKey" && scheme.in === "header") return { name: scheme.name ?? "X-Auth-Token", value: "$KEY" };
  return { name: "Authorization", value: "Bearer $KEY" };
}

function resolved({ operation, state }: { operation: Operation; state: RequestState }) {
  let path = operation.path;
  const query: [string, string][] = [];
  const headers: [string, string][] = [];
  for (const param of operation.parameters) {
    const value = state.values[paramKey({ location: param.in, name: param.name })]?.trim() ?? "";
    if (param.in === "path") path = path.replace(`{${param.name}}`, encodeURIComponent(value) || `<${param.name}>`);
    else if (!value) continue;
    else if (param.in === "query") query.push([param.name, value]);
    else if (param.in === "header") headers.push([param.name, value]);
  }
  const search = query.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&");
  return { url: `${operation.origin}${path}${search ? `?${search}` : ""}`, query, headers };
}

function pythonLiteral({ value, indent = 0 }: { value: unknown; indent?: number }): string {
  const pad = " ".repeat(indent + 4);
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[\n${value.map((item) => `${pad}${pythonLiteral({ value: item, indent: indent + 4 })}`).join(",\n")},\n${" ".repeat(indent)}]`;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length === 0 ? "{}" : `{\n${entries.map(([key, item]) => `${pad}${JSON.stringify(key)}: ${pythonLiteral({ value: item, indent: indent + 4 })}`).join(",\n")},\n${" ".repeat(indent)}}`;
}

function parseBody({ text }: { text: string }): unknown | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Display code for one language. The reader's key is always the LANGWATCH_API_KEY placeholder. */
export function generateExample({ operation, state, language }: { operation: Operation; state: RequestState; language: ExampleLanguage }): string {
  const { url, headers } = resolved({ operation, state });
  const auth = authHeader({ operation });
  const body = operation.body ? parseBody({ text: state.body }) : undefined;
  const method = operation.method;
  const allHeaders: [string, string][] = [...headers];
  if (body !== undefined) allHeaders.push(["Content-Type", "application/json"]);
  if (language === "curl") {
    const parts = [`curl --request ${method} \\`, `  --url "${url}" \\`];
    if (auth) parts.push(`  --header "${auth.name}: ${auth.value.replace("$KEY", `$${KEY_ENV}`)}" \\`);
    for (const [name, value] of allHeaders) parts.push(`  --header "${name}: ${value}" \\`);
    if (body !== undefined) parts.push(`  --data '${JSON.stringify(body)}' \\`);
    const last = parts.length - 1;
    parts[last] = parts[last].replace(/ \\$/, "");
    return parts.join("\n");
  }
  if (language === "python") {
    const headerLines = [
      ...(auth ? [`    ${JSON.stringify(auth.name)}: ${auth.value.includes("Bearer") ? `"Bearer " + os.environ["${KEY_ENV}"]` : `os.environ["${KEY_ENV}"]`},`] : []),
      ...allHeaders.map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)},`),
    ];
    const lines = ["import os", "import requests", "", `response = requests.${method.toLowerCase()}(`, `    "${url}",`];
    if (headerLines.length) lines.push("    headers={", ...headerLines.map((line) => `    ${line}`), "    },");
    if (body !== undefined) lines.push(`    json=${pythonLiteral({ value: body, indent: 4 })},`);
    lines.push(")", "print(response.json())");
    return lines.join("\n");
  }
  const headerLines = [
    ...(auth ? [`    ${JSON.stringify(auth.name)}: ${auth.value.includes("Bearer") ? `"Bearer " + process.env.${KEY_ENV}` : `process.env.${KEY_ENV}!`},`] : []),
    ...allHeaders.map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)},`),
  ];
  const lines = [`const response = await fetch("${url}", {`, `  method: "${method}",`];
  if (headerLines.length) lines.push("  headers: {", ...headerLines, "  },");
  if (body !== undefined) lines.push(`  body: JSON.stringify(${JSON.stringify(body, null, 2).split("\n").join("\n  ")}),`);
  lines.push("});", "const data = await response.json();");
  return lines.join("\n");
}

/** The live request: the entered key goes only into this call. */
export function liveRequest({ operation, state, key }: { operation: Operation; state: RequestState; key: string }) {
  const { url, headers } = resolved({ operation, state });
  const auth = authHeader({ operation });
  const init: Record<string, string> = Object.fromEntries(headers);
  if (auth && key) init[auth.name] = auth.value.replace("$KEY", key);
  const body = operation.body && state.body.trim() ? state.body : undefined;
  if (body !== undefined) init["Content-Type"] = "application/json";
  return { url, headers: init, body };
}

/** The editable JSON body the playground starts from; empty when the operation has none. */
export function initialBodyOf({ operation }: { operation: Operation }): string {
  const content = operation.body?.contents.find((entry) => entry.type.includes("json"));
  return content ? JSON.stringify(exampleFromSchema({ schema: content.schema }), null, 2) : "";
}
