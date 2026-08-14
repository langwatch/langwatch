import { describe, expect, it } from "vitest";

import {
  EMAIL_EXTERNAL_KINDS,
  EXTERNAL_KINDS_BY_PROVIDER,
  isEmailKind,
} from "../constants";

describe("EMAIL_EXTERNAL_KINDS", () => {
  // ADR-094 Decision 9 (amended v7): erasure must swap every kind whose value
  // is the person's address — `email`, and Microsoft's email-shaped `upn`.
  it("covers email and upn, nothing else", () => {
    expect([...EMAIL_EXTERNAL_KINDS].sort()).toEqual(["email", "upn"]);
  });

  it("every email kind is a declared provider kind", () => {
    const declared = new Set(
      Object.values(EXTERNAL_KINDS_BY_PROVIDER).flat() as string[],
    );
    for (const kind of EMAIL_EXTERNAL_KINDS) {
      expect(declared).toContain(kind);
    }
  });

  it("isEmailKind matches the list", () => {
    expect(isEmailKind("email")).toBe(true);
    expect(isEmailKind("upn")).toBe(true);
    expect(isEmailKind("entra_object_id")).toBe(false);
    expect(isEmailKind("numeric_id")).toBe(false);
  });
});
