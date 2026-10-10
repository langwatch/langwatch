export type PathSegment = {
  text: string;
  kind: "root" | "dot" | "property" | "index" | "other";
  /** The object key or array index this segment steps into, when it is a plain one. */
  key?: string | number;
};

export type SegmentStatus = "ok" | "missing" | "unchecked";

const TOKEN = /\$|\.(?=[A-Za-z_])|\.\.|\[\d+\]|\[['"][^'"]*['"]\]|[A-Za-z_][\w-]*|\[[^\]]*\]|./g;

/** Splits a JSONPath into the pieces the field colours: root, dots, names, indexes. */
export function parseJsonPath({ path }: { path: string }): PathSegment[] {
  const segments: PathSegment[] = [];
  for (const [text] of path.matchAll(TOKEN)) {
    if (text === "$") segments.push({ text, kind: "root" });
    else if (text === "." || text === "..") segments.push({ text, kind: "dot" });
    else if (/^\[\d+\]$/.test(text))
      segments.push({ text, kind: "index", key: Number(text.slice(1, -1)) });
    else if (/^\[['"].*['"]\]$/.test(text))
      segments.push({ text, kind: "property", key: text.slice(2, -2) });
    else if (/^[A-Za-z_][\w-]*$/.test(text)) segments.push({ text, kind: "property", key: text });
    else segments.push({ text, kind: "other" });
  }
  return segments;
}

function step({
  node,
  key,
  anyIndex,
}: {
  node: unknown;
  key: string | number;
  anyIndex: boolean;
}): { found: boolean; next?: unknown } {
  if (typeof key === "number" && Array.isArray(node)) {
    if (anyIndex) return { found: node.length > 0, next: node[0] };
    return { found: key < node.length, next: node[key] };
  }
  if (typeof key === "string" && node !== null && typeof node === "object" && !Array.isArray(node)) {
    return Object.hasOwn(node, key) ? { found: true, next: Reflect.get(node, key) } : { found: false };
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
    if (segment.key === undefined) return segment.kind === "other" ? "unchecked" : "ok";
    const result = step({ node, key: segment.key, anyIndex });
    if (!result.found) {
      broken = true;
      return "missing";
    }
    node = result.next;
    return "ok";
  });
}

/** The keys the path walks, or undefined when the path holds something we cannot follow. */
function pathKeys({ path }: { path: string }): (string | number)[] | undefined {
  const keys: (string | number)[] = [];
  for (const segment of parseJsonPath({ path })) {
    if (segment.kind === "other") return undefined;
    if (segment.key !== undefined) keys.push(segment.key);
  }
  return keys;
}

/**
 * Pretty-prints a value and reports the character range of the node `path` picks out,
 * so a preview can mark it. Returns no range when the path does not resolve.
 */
export function locateJsonPathNode({
  value,
  path,
}: {
  value: unknown;
  path: string;
}): { text: string; range?: { start: number; end: number } } {
  const keys = pathKeys({ path });
  let range: { start: number; end: number } | undefined;

  const write = (node: unknown, indent: string, remaining: (string | number)[] | undefined, at: number) => {
    const marked = remaining?.length === 0;
    let out = "";
    if (node !== null && typeof node === "object") {
      const entries: [string | number, unknown][] = Array.isArray(node)
        ? node.map((item, index) => [index, item])
        : Object.entries(node);
      const [open, close] = Array.isArray(node) ? ["[", "]"] : ["{", "}"];
      if (entries.length === 0) out = open + close;
      else {
        out = `${open}\n`;
        entries.forEach(([key, child], index) => {
          const prefix = `${indent}  ${Array.isArray(node) ? "" : `${JSON.stringify(key)}: `}`;
          const onPath = remaining !== undefined && remaining[0] === key;
          out += prefix;
          out += write(child, `${indent}  `, onPath ? remaining?.slice(1) : undefined, at + out.length);
          out += index < entries.length - 1 ? ",\n" : "\n";
        });
        out += `${indent}${close}`;
      }
    } else out = JSON.stringify(node) ?? "null";
    if (marked && !range) range = { start: at, end: at + out.length };
    return out;
  };

  const text = write(value, "", keys, 0);
  return range ? { text, range } : { text };
}
