export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Thrown when a value about to be persisted is not exactly
 * JSON-representable. `path` points at the offending value, e.g. `$.a[1].b`.
 */
export class JsonSafetyError extends Error {
  constructor(
    public readonly path: string,
    reason: string,
  ) {
    super(`Value at ${path} is not JSON-safe: ${reason}`);
    this.name = "JsonSafetyError";
  }
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}

function walk({ value, path, seen }: { value: unknown; path: string; seen: Set<object> }): void {
  if (value === null) return;

  switch (typeof value) {
    case "boolean":
    case "string":
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new JsonSafetyError(path, "non-finite number");
      }
      return;
    case "undefined":
      throw new JsonSafetyError(path, "undefined");
    case "function":
      throw new JsonSafetyError(path, "function");
    case "bigint":
      throw new JsonSafetyError(path, "bigint");
    case "symbol":
      throw new JsonSafetyError(path, "symbol");
    case "object":
      break;
    default:
      throw new JsonSafetyError(path, `unsupported type ${typeof value}`);
  }

  const obj = value as object;
  if (seen.has(obj)) {
    throw new JsonSafetyError(path, "circular reference");
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      walk({ value: item, path: `${path}[${index}]`, seen });
    });
  } else {
    if (!isPlainObject(obj)) {
      throw new JsonSafetyError(path, `non-plain object (${obj.constructor?.name ?? "unknown"})`);
    }
    if (Object.getOwnPropertySymbols(obj).length > 0) {
      throw new JsonSafetyError(path, "symbol-keyed property");
    }
    for (const [key, item] of Object.entries(obj)) {
      walk({ value: item, path: `${path}.${key}`, seen });
    }
  }

  seen.delete(obj);
}

/**
 * Validates that `value` is exactly JSON-representable — no values
 * `JSON.stringify` would throw on (bigint, circular), drop (function,
 * symbol), or silently mangle (undefined, NaN/Infinity, Date and other
 * non-plain objects). Returns the same reference, narrowed to JsonValue.
 */
export function ensureJsonSafe(value: unknown): JsonValue {
  walk({ value, path: "$", seen: new Set() });
  return value as JsonValue;
}

/**
 * Structural equality over process state, which is JSON by contract.
 *
 * Key ORDER must not decide this: handlers build their result by spreading
 * the previous state, and a spread that reaches the same values by a
 * different insertion order is the same state. A serialise-and-compare would
 * call those different and quietly write an instance row per event, which is
 * the exact cost the transient path exists to avoid.
 */
export function isDeepJsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => isDeepJsonEqual(item, b[index]));
  }
  if (typeof a !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && isDeepJsonEqual(left[key], right[key]),
  );
}
