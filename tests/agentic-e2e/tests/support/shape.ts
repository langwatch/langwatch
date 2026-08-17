/**
 * Structural contract checking against a checked-in expected shape.
 *
 * The point is drift detection. A response that silently changes shape breaks
 * consumers that no test covers — the MCP annotation tools are a live example:
 * every annotations route returns `{ data: ... }`, the MCP client casts the
 * result straight to an array, and because the cast is unchecked the compiler
 * cannot see it. `platform_list_annotations` therefore answers "No annotations
 * found" for every project, and nothing failed.
 *
 * So we pin the shape to a static file and compare the live response against
 * it. Three outcomes, deliberately distinguished:
 *
 *   missing  a field the contract promises has disappeared  -> breaking
 *   changed  a field's type changed                         -> breaking
 *   added    a field the contract doesn't mention appeared  -> drift
 *
 * Breaking changes fail loudly. Additions also fail, but with a message that
 * says to update the golden file — an additive change is safe to accept, it
 * just has to be an explicit decision rather than an unnoticed one.
 */

/** A type name, optionally suffixed with `?` to mark the field optional. */
export type ShapeSpec =
  | string
  | ShapeSpec[]
  | { [key: string]: ShapeSpec };

export type ShapeDiff = {
  missing: string[];
  changed: string[];
  added: string[];
  /** Arrays that were empty, so their element shape could not be checked. */
  unverified: string[];
};

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isOptional(spec: ShapeSpec): boolean {
  return typeof spec === "string" && spec.endsWith("?");
}

function baseType(spec: string): string {
  return spec.endsWith("?") ? spec.slice(0, -1) : spec;
}

function walk(
  actual: unknown,
  expected: ShapeSpec,
  path: string,
  diff: ShapeDiff,
): void {
  // Array contract: [itemSpec] — every element must match itemSpec.
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      diff.changed.push(`${path}: expected array, got ${typeOf(actual)}`);
      return;
    }
    const itemSpec = expected[0];
    if (itemSpec === undefined) return;
    if (actual.length === 0) {
      diff.unverified.push(path);
      return;
    }
    actual.forEach((item, index) => {
      walk(item, itemSpec, `${path}[${index}]`, diff);
    });
    return;
  }

  // Object contract: recurse per key, and flag keys we didn't expect.
  if (typeof expected === "object") {
    if (typeOf(actual) !== "object") {
      diff.changed.push(`${path}: expected object, got ${typeOf(actual)}`);
      return;
    }
    const actualRecord = actual as Record<string, unknown>;

    for (const [key, keySpec] of Object.entries(expected)) {
      const childPath = path ? `${path}.${key}` : key;
      const present = Object.prototype.hasOwnProperty.call(actualRecord, key);

      if (!present) {
        if (!isOptional(keySpec)) diff.missing.push(childPath);
        continue;
      }
      // An optional field that is present as null is still satisfied.
      if (isOptional(keySpec) && actualRecord[key] === null) continue;

      walk(actualRecord[key], keySpec, childPath, diff);
    }

    for (const key of Object.keys(actualRecord)) {
      if (!Object.prototype.hasOwnProperty.call(expected, key)) {
        diff.added.push(path ? `${path}.${key}` : key);
      }
    }
    return;
  }

  // Scalar contract: a type name.
  const wanted = baseType(expected);
  if (wanted === "any") return;
  const got = typeOf(actual);
  if (got !== wanted) {
    diff.changed.push(`${path}: expected ${wanted}, got ${got}`);
  }
}

/**
 * Derives a shape from a live response, for authoring a golden file.
 *
 * Only ever run deliberately (`E2E_RECORD_CONTRACTS=1`) and the output is
 * meant to be read before committing — recording blindly would just pin
 * whatever the code does today, including its bugs.
 *
 * Nulls become `"any?"`: a null tells us the field exists and is nullable but
 * not what it holds, and guessing a concrete type there would produce a
 * contract that fails on the next non-null response.
 */
export function deriveShape(value: unknown): ShapeSpec {
  if (value === null) return "any?";
  if (Array.isArray(value)) {
    const first = value[0];
    return first === undefined ? [] : [deriveShape(first)];
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        deriveShape(child),
      ]),
    );
  }
  return typeof value;
}

export function diffShape(actual: unknown, expected: ShapeSpec): ShapeDiff {
  const diff: ShapeDiff = { missing: [], changed: [], added: [], unverified: [] };
  walk(actual, expected, "", diff);
  return diff;
}

/**
 * Renders a diff as an assertion message, or returns null when the shape
 * matches. Callers assert on `null` so the failure text carries the detail.
 */
export function describeShapeDiff(
  label: string,
  diff: ShapeDiff,
): string | null {
  const problems: string[] = [];

  if (diff.missing.length > 0) {
    problems.push(
      `BREAKING — fields the contract promises are gone:\n    ${diff.missing.join("\n    ")}`,
    );
  }
  if (diff.changed.length > 0) {
    problems.push(
      `BREAKING — fields changed type:\n    ${diff.changed.join("\n    ")}`,
    );
  }
  if (diff.added.length > 0) {
    problems.push(
      `DRIFT — new fields not in the contract (safe, but update the golden file to accept them):\n    ${diff.added.join("\n    ")}`,
    );
  }

  if (problems.length === 0) return null;

  const unverifiedNote =
    diff.unverified.length > 0
      ? `\n  (element shape unchecked for empty arrays: ${diff.unverified.join(", ")})`
      : "";

  return `${label} no longer matches its contract.\n\n  ${problems.join("\n\n  ")}${unverifiedNote}\n`;
}
