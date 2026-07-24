import { captureException, toError } from "./posthogErrorCapture";

const truncateString = (str: string, maxLength: number): string => {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
};

const truncateRecursive = (
  data: unknown,
  options: {
    maxStringLength: number;
    maxTotalLength: number;
  },
): unknown => {
  if (typeof data === "string") {
    return truncateString(data, options.maxStringLength);
  }

  if (Array.isArray(data)) {
    return data.map((item) => truncateRecursive(item, options));
  }

  if (typeof data === "object" && data !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = truncateRecursive(value, options);
    }
    return result;
  }

  return data;
};

const truncateWithSizeLimit = (
  data: unknown,
  maxTotalLength: number,
  stringLengths: number[],
): unknown => {
  if (JSON.stringify(data).length <= maxTotalLength) {
    return data;
  }

  for (const stringLength of stringLengths) {
    const truncated = truncateRecursive(data, {
      maxStringLength: stringLength,
      maxTotalLength,
    });

    if (JSON.stringify(truncated).length <= maxTotalLength) {
      return truncated;
    }
  }

  // The serialised length of an object is the sum of its entries' lengths plus
  // the separators, so we can track the running total by serialising each value
  // exactly once. Re-serialising the whole accumulated object on every key (as
  // this used to) is quadratic, and it runs on precisely the inputs already
  // known to be oversized.
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const entries = Object.entries(data);
    const result: Record<string, unknown> = {};

    // Matches what the old whole-object `JSON.stringify(tempResult).length`
    // measured: the accumulated object *without* the truncation marker, which
    // is why the budget below keeps the same `- 50` headroom for it.
    let length = "{}".length;
    let kept = 0;

    for (const [key, value] of entries) {
      const truncated = truncateRecursive(value, {
        maxStringLength: 2 * 1024,
        maxTotalLength,
      });

      // Serialize within the real property-key context, not standalone:
      // `JSON.stringify(truncated)` alone always invokes a custom `toJSON()`
      // with key `""`, so a key-sensitive `toJSON()` could measure smaller (or
      // larger) here than it renders inside the final object, letting an
      // oversized entry slip past `maxTotalLength`. Wrapping in `{ [key]: ... }`
      // reproduces the exact key `JSON.stringify` will call `toJSON()` with.
      //
      // `JSON.stringify` drops undefined/function/symbol values from an
      // object entirely, which is indistinguishable from key `""` here, so
      // the wrapped form comes back as the literal string `"{}"` — those keys
      // cost nothing and must not be measured with `.length`.
      const quotedKey = JSON.stringify(key);
      const wrapped = JSON.stringify({ [key]: truncated });
      const serializedValue =
        wrapped === "{}" ? undefined : wrapped.slice(quotedKey.length + 2, -1);
      const entryLength =
        serializedValue === undefined
          ? 0
          : quotedKey.length +
            ":".length +
            serializedValue.length +
            (kept > 0 ? ",".length : 0);

      // Leave room for the truncation marker.
      if (length + entryLength > maxTotalLength - 50) break;

      result[key] = truncated;
      length += entryLength;
      if (entryLength > 0) kept++;
    }

    return {
      ...result,
      "...": "[truncated]",
    };
  }

  return data;
};

export const safeTruncate = <T>(
  data: T,
  maxTotalLength = 32 * 1024, // 32KB
  stringLengths = [24 * 1024, 16 * 1024, 8 * 1024, 4 * 1024, 2 * 1024, 1024],
): T => {
  try {
    return truncateWithSizeLimit(data, maxTotalLength, stringLengths) as T;
  } catch (error) {
    captureException(
      toError(error),
      { extra: { data } },
    );
    return data;
  }
};
