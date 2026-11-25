// Narrows the OpenAPI document to the routes this SDK calls before its client types are generated.
// The routes are read from the source, never listed by hand: every `.GET("/api/...")`-style call,
// every `paths["..."]`, `operations["..."]` and `components["schemas"]["..."]` index. Component
// schemas the kept routes reach through `$ref` are kept with them; everything else is dropped.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CALL = /\.(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(\s*"([^"]+)"/g;
const PATH_INDEX = /\bpaths\[\s*"([^"]+)"\s*\]/g;
const OPERATION_INDEX = /\boperations\[\s*"([^"]+)"\s*\]/g;
const SCHEMA_INDEX = /\bcomponents\[\s*"schemas"\s*\]\[\s*"([^"]+)"\s*\]/g;
const COMPONENT_REF = /^#\/components\/([^/]+)\/([^/]+)$/;

/**
 * Every `.ts` file under a directory, sorted, skipping `node_modules` and the skipped directories.
 * @param {{ directory: string, skip: string[] }} options
 * @returns {string[]}
 */
export function listSourceFiles({ directory, skip }) {
  return readdirSync(directory)
    .toSorted()
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        if (entry === "node_modules" || skip.includes(path)) return [];
        return listSourceFiles({ directory: path, skip });
      }
      return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
    });
}

/**
 * @param {{ source: string, pattern: RegExp }} options
 * @returns {string[]}
 */
function captures({ source, pattern }) {
  return [...source.matchAll(pattern)].flatMap((match) => (match[1] ? [match[1]] : []));
}

/**
 * The paths, operation ids and schema names the given sources name.
 * @param {{ sources: string[] }} options
 * @returns {{ paths: Set<string>, operations: Set<string>, schemas: Set<string> }}
 */
export function collectReferences({ sources }) {
  const paths = new Set();
  const operations = new Set();
  const schemas = new Set();
  for (const source of sources) {
    for (const path of captures({ source, pattern: CALL })) paths.add(path);
    for (const path of captures({ source, pattern: PATH_INDEX })) paths.add(path);
    for (const id of captures({ source, pattern: OPERATION_INDEX })) operations.add(id);
    for (const name of captures({ source, pattern: SCHEMA_INDEX })) schemas.add(name);
  }
  return { paths, operations, schemas };
}

/**
 * Every `$ref` string anywhere inside a value.
 * @param {unknown} value
 * @returns {string[]}
 */
function refsIn(value) {
  if (Array.isArray(value)) return value.flatMap((item) => refsIn(item));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : refsIn(child),
  );
}

/**
 * @param {Record<string, unknown>} pathItem
 * @param {Set<string>} operations
 * @returns {boolean}
 */
function declaresOperation(pathItem, operations) {
  return Object.values(pathItem).some(
    (operation) =>
      operation !== null &&
      typeof operation === "object" &&
      "operationId" in operation &&
      typeof operation.operationId === "string" &&
      operations.has(operation.operationId),
  );
}

/**
 * A copy of the document holding only the referenced routes and the components they reach.
 * Security schemes are kept whole: the top-level `security` names them without a `$ref`.
 * @param {{ document: any, references: ReturnType<typeof collectReferences> }} options
 * @returns {any}
 */
export function filterDocument({ document, references }) {
  /** @type {Record<string, Record<string, unknown>>} */
  const allPaths = document.paths ?? {};
  const paths = Object.fromEntries(
    Object.entries(allPaths).filter(
      ([path, item]) =>
        references.paths.has(path) || declaresOperation(item, references.operations),
    ),
  );

  /** @type {Record<string, Record<string, unknown>>} */
  const allComponents = document.components ?? {};
  /** @type {Map<string, Set<string>>} */
  const reached = new Map();
  const pending = [
    ...refsIn(paths),
    ...[...references.schemas].map((name) => `#/components/schemas/${name}`),
  ];
  while (pending.length > 0) {
    const match = COMPONENT_REF.exec(pending.pop() ?? "");
    if (!match?.[1] || !match[2]) continue;
    const [, kind, name] = match;
    const names = reached.get(kind) ?? new Set();
    const component = allComponents[kind]?.[name];
    if (names.has(name) || component === undefined) continue;
    names.add(name);
    reached.set(kind, names);
    pending.push(...refsIn(component));
  }

  const components = Object.fromEntries(
    Object.entries(allComponents).map(([kind, members]) => [
      kind,
      kind === "securitySchemes"
        ? members
        : Object.fromEntries(
            Object.entries(members).filter(([name]) => reached.get(kind)?.has(name)),
          ),
    ]),
  );
  return { ...document, paths, components };
}

/**
 * The document narrowed to what the SDK source under `sourceDirectory` names.
 * @param {{ document: any, sourceDirectory: string, generatedDirectory: string }} options
 * @returns {any}
 */
export function filterDocumentForSource({ document, sourceDirectory, generatedDirectory }) {
  const files = listSourceFiles({ directory: sourceDirectory, skip: [generatedDirectory] });
  const sources = files.map((file) => readFileSync(file, "utf8"));
  return filterDocument({ document, references: collectReferences({ sources }) });
}
