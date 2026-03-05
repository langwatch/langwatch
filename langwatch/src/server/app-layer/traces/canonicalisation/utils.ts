import type {
  NormalizedAttrScalar,
  NormalizedAttrValue,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";

export const toAttrValue = (v: unknown): NormalizedAttrValue | null => {
  if (v === null || v === undefined) return null;

  if (
    typeof v === "string" ||
    typeof v === "boolean" ||
    typeof v === "number" ||
    typeof v === "bigint"
  ) {
    return v;
  }

  if (Array.isArray(v)) {
    const ok = v.every(
      (x) =>
        typeof x === "string" ||
        typeof x === "boolean" ||
        typeof x === "number" ||
        typeof x === "bigint",
    );
    if (ok) return v as NormalizedAttrScalar[];

    // arrays of objects/etc -> stringify
    try {
      return JSON.stringify(v);
    } catch {
      return null;
    }
  }

  // objects/etc -> stringify
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
};
