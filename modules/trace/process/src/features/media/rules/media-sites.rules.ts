/**
 * Where inline media sits inside an arbitrary JSON value: every media part and whole-string
 * `data:` URI, at any depth, through marker-gated nested JSON strings. No I/O.
 */

import {
  MAX_MEDIA_WALK_DEPTH,
  containsMediaMarkers,
  parseBase64DataUri,
  visitContentPart,
} from "@langwatch/trace-contract";

/** One step from the root value: an object key, an array index, or a parsed JSON string. */
export type MediaPathSegment = { key: string } | { index: number } | { json: true };

/** A media part, or a string whose whole value is one base64 `data:` URI. */
export type MediaSite = Readonly<{
  path: MediaPathSegment[];
  node: unknown;
  kind: "part" | "bareDataUri";
}>;

/**
 * True when the object is a media part carrying inline bytes; url-only and non-part objects are
 * false. It uses the same `visitContentPart` dispatcher as the part rules, so they cannot disagree.
 */
export function isExtractableMediaPart(part: unknown): boolean {
  if (typeof part !== "object" || part === null) return false;

  return (
    visitContentPart<boolean>(part, {
      text: () => false,
      toolCall: () => false,
      toolResult: () => false,
      media: (p) =>
        p.source.type === "data" &&
        typeof p.source.value === "string" &&
        typeof p.source.mimeType === "string",
      binary: (p) => p.data !== undefined && p.url === undefined && p.id === undefined,
      imageUrl: (url) => parseBase64DataUri(url) !== null,
      bareImage: (src) => parseBase64DataUri(src) !== null,
      inputAudio: (p) => typeof p.data === "string",
      unknown: () => false,
    }) ?? false
  );
}

function isBareDataUri(value: string): boolean {
  return value.startsWith("data:") && !/\s/.test(value) && parseBase64DataUri(value) !== null;
}

type Walk = { depth: number; path: MediaPathSegment[]; sites: MediaSite[] };

function collectFromString(value: string, { depth, path, sites }: Walk): void {
  if (isBareDataUri(value)) {
    sites.push({ path, node: value, kind: "bareDataUri" });
    return;
  }

  // No upper bound: the string is already in memory, and the intake cap bounds its size.
  const worthParsing = value.length >= 2 && containsMediaMarkers(value);
  if (!worthParsing) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return;
  }

  if (typeof parsed !== "object" || parsed === null) return;
  collect(parsed, { depth: depth + 1, path: [...path, { json: true }], sites });
}

/** Part-first: a media part is a leaf, so the walk never descends into one. */
function collectFromObject(value: object, { depth, path, sites }: Walk): void {
  if (isExtractableMediaPart(value)) {
    sites.push({ path, node: value, kind: "part" });
    return;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    collect(obj[key], { depth: depth + 1, path: [...path, { key }], sites });
  }
}

function collect(value: unknown, walk: Walk): void {
  if (value == null || walk.depth > MAX_MEDIA_WALK_DEPTH) return;
  if (typeof value === "string") {
    collectFromString(value, walk);
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collect(value[i], { ...walk, depth: walk.depth + 1, path: [...walk.path, { index: i }] });
    }

    return;
  }

  if (typeof value === "object") collectFromObject(value, walk);
}

/** Every inline media site in `value`, in walk order. */
export function findMediaSites(value: unknown): MediaSite[] {
  const sites: MediaSite[] = [];
  collect(value, { depth: 0, path: [], sites });

  return sites;
}
