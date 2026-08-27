import { isUnknownArray } from "./canonical-guard.rules";

type CanonicalAttrScalar = string | boolean | number | bigint;
type CanonicalAttrValue = CanonicalAttrScalar | CanonicalAttrScalar[];

const isCanonicalAttrScalar = (value: unknown): value is CanonicalAttrScalar =>
  typeof value === "string" ||
  typeof value === "boolean" ||
  typeof value === "number" ||
  typeof value === "bigint";

const isCanonicalAttrScalarArray = (value: unknown): value is CanonicalAttrScalar[] =>
  isUnknownArray(value) && value.every(isCanonicalAttrScalar);

export const toAttrValue = (v: unknown): CanonicalAttrValue | null => {
  if (v === null || v === void 0) {
    return null;
  }

  if (isCanonicalAttrScalar(v)) {
    return v;
  }

  if (isUnknownArray(v)) {
    if (isCanonicalAttrScalarArray(v)) {
      return v;
    }

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
