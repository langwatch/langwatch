import { describe, expect, it } from "vitest";
import { Temporal } from "@langwatch/time";
import {
  organizationProvisioningSummaryFromDate,
  organizationMemberDatesFromDate,
} from "../organization-time-boundary.rules.ts";

const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const UPDATED_AT = new Date("2026-01-02T00:00:00.000Z");

describe("organization API time boundary", () => {
  it("maps member timestamps to Instants and preserves a null disabledAt", () => {
    const mapped = organizationMemberDatesFromDate({
      userId: "user",
      organizationId: "organization",
      role: "ADMIN",
      disabledAt: null,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      user: { id: "user", name: "Ada", email: "ada@example.com" },
    });

    expect(mapped.createdAt).toBeInstanceOf(Temporal.Instant);
    expect(mapped.updatedAt.epochMilliseconds).toBe(UPDATED_AT.getTime());
    expect(mapped.disabledAt).toBeNull();
  });

  it("maps provisioning timestamps without changing summary metadata", () => {
    const mapped = organizationProvisioningSummaryFromDate({
      id: "organization",
      name: "Acme",
      slug: "acme",
      createdAt: CREATED_AT,
    });

    expect(mapped).toMatchObject({ id: "organization", name: "Acme", slug: "acme" });
    expect(mapped.createdAt.epochMilliseconds).toBe(CREATED_AT.getTime());
  });
});
