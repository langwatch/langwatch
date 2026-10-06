/**
 * The RFC 7644 error documents a SCIM operation refuses with.
 */
import { describe, expect, it } from "vitest";

import { scimErrorDocument } from "../scim-refusal.rules.ts";

describe("scimErrorDocument", () => {
  it("carries the scimType when a refusal names one", () => {
    expect(
      scimErrorDocument({
        status: "409",
        scimType: "uniqueness",
        detail: "User name already exists in this organization",
      }),
    ).toStrictEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "409",
      detail: "User name already exists in this organization",
      scimType: "uniqueness",
    });
  });

  it("leaves scimType out entirely when none is given", () => {
    const document = scimErrorDocument({ status: "404", detail: "User not found" });

    expect(document).toStrictEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "404",
      detail: "User not found",
    });
    expect(Object.keys(document)).toEqual(["schemas", "status", "detail"]);
  });
});
