export type PathSegment = {
  text: string;
  kind: "root" | "dot" | "property" | "index" | "other";
  /** The object key or array index this segment steps into, when it is a plain one. */
  key?: string | number;
  /** A `[start:end]` slice; either bound may be absent or negative, as in Python. */
  slice?: { start?: number; end?: number };
};

export type SegmentStatus = "ok" | "missing" | "unchecked";

const TOKEN =
  /\$|\.(?=[A-Za-z_])|\.\.|\[-?\d+\]|\[-?\d*:-?\d*\]|\[['"][^'"]*['"]\]|[A-Za-z_][\w-]*|\[[^\]]*\]|./g;

/** Splits a JSONPath into the pieces the field colours: root, dots, names, indexes. */
export function parseJsonPath({ path }: { path: string }): PathSegment[] {
  const segments: PathSegment[] = [];
  for (const [text] of path.matchAll(TOKEN)) {
    if (text === "$") segments.push({ text, kind: "root" });
    else if (text === "." || text === "..") segments.push({ text, kind: "dot" });
    else if (/^\[-?\d+\]$/.test(text))
      segments.push({ text, kind: "index", key: Number(text.slice(1, -1)) });
    else if (/^\[-?\d*:-?\d*\]$/.test(text)) {
      const [start, end] = text
        .slice(1, -1)
        .split(":")
        .map((bound) => (bound === "" ? undefined : Number(bound)));
      segments.push({ text, kind: "index", slice: { start, end } });
    } else if (/^\[['"].*['"]\]$/.test(text))
      segments.push({ text, kind: "property", key: text.slice(2, -2) });
    else if (/^[A-Za-z_][\w-]*$/.test(text)) segments.push({ text, kind: "property", key: text });
    else segments.push({ text, kind: "other" });
  }
  return segments;
}

/** The concrete array indexes an index or slice segment picks out of an array this long. */
function pickIndexes({ segment, length }: { segment: PathSegment; length: number }): number[] {
  const resolve = (bound: number) =>
    Math.min(Math.max(bound < 0 ? bound + length : bound, 0), length);
  if (segment.slice) {
    const start = resolve(segment.slice.start ?? 0);
    const end = resolve(segment.slice.end ?? length);
    return Array.from({ length: Math.max(end - start, 0) }, (_, offset) => start + offset);
  }
  if (typeof segment.key !== "number") return [];
  const index = segment.key < 0 ? segment.key + length : segment.key;
  return index >= 0 && index < length ? [index] : [];
}

function step({
  node,
  segment,
  anyIndex,
}: {
  node: unknown;
  segment: PathSegment;
  anyIndex: boolean;
}): { found: boolean; next?: unknown } {
  const key = segment.key;
  if (segment.kind === "index" && Array.isArray(node)) {
    if (anyIndex) return { found: node.length > 0, next: node[0] };
    const [index] = pickIndexes({ segment, length: node.length });
    return index === undefined ? { found: false } : { found: true, next: node[index] };
  }
  if (
    typeof key === "string" &&
    node !== null &&
    typeof node === "object" &&
    !Array.isArray(node)
  ) {
    const own = Object.getOwnPropertyDescriptor(node, key);
    return own ? { found: true, next: own.value } : { found: false };
  }
  return { found: false };
}

/**
 * Checks each segment against a known shape. Dots and the root are fine, the first
 * segment that does not resolve is `missing`, and what follows it is `unchecked`.
 * `anyIndex` treats a sample array as standing for every index (a schema, not data).
 */
export function checkJsonPath({
  segments,
  shape,
  anyIndex = false,
}: {
  segments: PathSegment[];
  shape: unknown;
  anyIndex?: boolean;
}): SegmentStatus[] {
  let node = shape;
  let broken = false;
  return segments.map((segment) => {
    if (broken) return "unchecked";
    if (segment.key === undefined && !segment.slice)
      return segment.kind === "other" ? "unchecked" : "ok";
    const result = step({ node, segment, anyIndex });
    if (!result.found) {
      broken = true;
      return "missing";
    }
    node = result.next;
    return "ok";
  });
}

/** The one concrete key `segment` steps into at `node`; undefined when it picks none or many. */
function concreteKey({
  node,
  segment,
}: {
  node: unknown;
  segment: PathSegment;
}): string | number | undefined {
  if (segment.kind !== "index") return segment.key;
  const picked = Array.isArray(node) ? pickIndexes({ segment, length: node.length }) : [];
  return picked.length === 1 ? picked[0] : undefined;
}

/**
 * The concrete keys the path walks through `value`, or undefined when it holds something
 * we cannot follow or a slice that picks more than one element.
 */
function pathKeys({
  path,
  value,
}: {
  path: string;
  value: unknown;
}): (string | number)[] | undefined {
  const keys: (string | number)[] = [];
  let node = value;
  for (const segment of parseJsonPath({ path })) {
    if (segment.kind === "other") return undefined;
    if (segment.key === undefined && !segment.slice) continue;
    const key = concreteKey({ node, segment });
    if (key === undefined) return undefined;
    keys.push(key);
    node = step({ node, segment: { ...segment, key, slice: undefined }, anyIndex: false }).next;
  }
  return keys;
}

/**
 * Pretty-prints a value and reports the character range of the node `path` picks out,
 * so a preview can mark it. Returns no range when the path does not resolve.
 */
export function locateJsonPathNode({ value, path }: { value: unknown; path: string }): {
  text: string;
  range?: { start: number; end: number };
} {
  const keys = pathKeys({ path, value });
  const found: { range?: { start: number; end: number } } = {};
  const text = writeJsonNode({ node: value, indent: "", remaining: keys, at: 0, found });
  return found.range ? { text, range: found.range } : { text };
}

type JsonWriteInput = {
  node: unknown;
  indent: string;
  remaining: (string | number)[] | undefined;
  at: number;
  found: { range?: { start: number; end: number } };
};

function writeJsonNode({ node, indent, remaining, at, found }: JsonWriteInput): string {
  const out = isContainer(node)
    ? writeContainer({ node, indent, remaining, at, found })
    : (JSON.stringify(node) ?? "null");
  if (remaining?.length === 0 && !found.range) found.range = { start: at, end: at + out.length };
  return out;
}

function isContainer(node: unknown): node is object {
  return node !== null && typeof node === "object";
}

function writeContainer({ node, indent, remaining, at, found }: JsonWriteInput & { node: object }) {
  const isArray = Array.isArray(node);
  const entries: [string | number, unknown][] = isArray
    ? node.map((item, index) => [index, item])
    : Object.entries(node);
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) return open + close;
  let out = `${open}\n`;
  entries.forEach(([key, child], index) => {
    out += `${indent}  ${isArray ? "" : `${JSON.stringify(key)}: `}`;
    const onPath = remaining !== undefined && remaining[0] === key;
    out += writeJsonNode({
      node: child,
      indent: `${indent}  `,
      remaining: onPath ? remaining?.slice(1) : undefined,
      at: at + out.length,
      found,
    });
    out += index < entries.length - 1 ? ",\n" : "\n";
  });
  return `${out}${indent}${close}`;
}
