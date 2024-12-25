import * as Sentry from "@sentry/nextjs";

const truncateString = (str: string, maxLength: number): string => {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
};

const truncateRecursive = (
  data: unknown,
  options: {
    maxStringLength: number;
    maxTotalLength: number;
  }
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
  stringLengths: number[]
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

  // If still too large, start dropping keys
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const entries = Object.entries(data);
    let result: Record<string, unknown> = {};

    for (let i = 0; i < entries.length; i++) {
      const tempResult = {
        ...result,
        [entries[i][0]]: truncateRecursive(entries[i][1], {
          maxStringLength: 2 * 1024,
          maxTotalLength,
        }),
      };

      if (JSON.stringify(tempResult).length <= maxTotalLength - 50) {
        // Leave room for truncation marker
        result = tempResult;
      } else {
        break;
      }
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
  stringLengths = [16 * 1024, 8 * 1024, 4 * 1024, 2 * 1024]
): T => {
  try {
    return truncateWithSizeLimit(data, maxTotalLength, stringLengths) as T;
  } catch (error) {
    Sentry.captureException(error, {
      extra: { data },
    });
    return data;
  }
};
