import { describe, expect, it } from "vitest";

import { SAAS_FEATURE_ID, saasBrowserScopeSchema, saasBrowserUserSchema } from "../index";

describe("SaaS browser contract", () => {
  it("exposes its stable catalogue identifier", () => {
    expect(SAAS_FEATURE_ID).toBe("saas");
  });

  it("validates portable browser context", () => {
    expect(
      saasBrowserUserSchema.parse({
        id: "user_1",
        email: null,
        name: "Ada",
        impersonator: null,
      }),
    ).toEqual({
      id: "user_1",
      email: null,
      name: "Ada",
      impersonator: null,
    });
    expect(saasBrowserScopeSchema.parse({ id: "project_1", name: "Example" })).toEqual({
      id: "project_1",
      name: "Example",
    });
  });
});
