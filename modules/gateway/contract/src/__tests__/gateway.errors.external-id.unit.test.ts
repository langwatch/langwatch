/**
 * The unique index decides whether an external id was free; the refusal is read off its violation.
 * @see specs/ai-gateway/public-rest-api.feature
 */
import { describe, expect, it } from "vitest";

import { translateExternalIdConflict } from "../gateway.errors.ts";

const uniqueViolation = (target: string[]) => ({ code: "P2002", meta: { target } });

describe("translateExternalIdConflict", () => {
  /** @scenario A second resource cannot claim an external id already in use */
  it("answers 409 external_id_conflict naming the resource and the id sent", () => {
    expect(() =>
      translateExternalIdConflict(
        uniqueViolation(["organizationId", "externalId"]),
        "virtual_key",
        "vk-dupe",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "external_id_conflict",
        httpStatus: 409,
        meta: { resource: "virtual_key", external_id: "vk-dupe" },
      }),
    );
  });

  it("leaves a violation with no external id to the caller's own handling", () => {
    const violation = uniqueViolation(["organizationId", "externalId"]);

    expect(() => translateExternalIdConflict(violation, "virtual_key", null)).toThrow(
      expect.objectContaining({ code: "P2002" }),
    );
  });

  it("does not claim a violation of another unique index", () => {
    const violation = uniqueViolation(["hashedSecret"]);

    expect(() => translateExternalIdConflict(violation, "virtual_key", "vk-dupe")).toThrow(
      expect.objectContaining({ code: "P2002" }),
    );
  });
});
