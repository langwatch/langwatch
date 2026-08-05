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

function walk({
  value,
  path,
  seen,
}: {
  value: unknown;
  path: string;
  seen: Set<object>;
}): void {
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
      throw new JsonSafetyError(
        path,
        `non-plain object (${obj.constructor?.name ?? "unknown"})`,
      );
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
