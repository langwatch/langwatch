import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  claimOrganizationBillingCustomerInputSchema,
  addOrganizationTeamMemberInputSchema,
  createOrganizationTeamInputSchema,
  getOldestTeamInputSchema,
  createOrganizationGroupInputSchema,
  organizationGroupBindingInputSchema,
  organizationBillingProfileSchema,
  type OrganizationService,
} from "../index.ts";

describe("OrganizationService contract", () => {
  it("requires a non-empty organization id", () => {
    expect(() => getOldestTeamInputSchema.parse({ organizationId: "" })).toThrow(z.ZodError);
  });

  it("exposes a required non-null team lookup", () => {
    // The claim is entirely about the type: `getOldestTeamId` answers a string,
    // never `string | null`. It used to be checked by passing "team" to a
    // helper and then asserting `true` is `true`, so the runtime expectation
    // held whatever the type said.
    expectTypeOf<
      Awaited<ReturnType<OrganizationService["getOldestTeamId"]>>
    >().toEqualTypeOf<string>();
  });

  it("validates portable billing profile values and claims", () => {
    expect(
      organizationBillingProfileSchema.parse({
        id: "org",
        name: "Acme",
        billingCustomerId: null,
      }),
    ).toMatchObject({ id: "org" });
    expect(() =>
      claimOrganizationBillingCustomerInputSchema.parse({
        organizationId: "org",
        billingCustomerId: "",
      }),
    ).toThrow(z.ZodError);
  });

  it("validates team writes and their durable actor", () => {
    expect(
      addOrganizationTeamMemberInputSchema.parse({
        organizationId: "org",
        teamId: "team",
        userId: "user",
        role: "MEMBER",
        actor: { type: "user", id: "actor" },
      }),
    ).toMatchObject({ teamId: "team", role: "MEMBER" });
    expect(() =>
      addOrganizationTeamMemberInputSchema.parse({
        organizationId: "org",
        teamId: "team",
        userId: "user",
        role: "OWNER",
        actor: { type: "user", id: "actor" },
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      createOrganizationTeamInputSchema.parse({
        organizationId: "org",
        name: "",
      }),
    ).toThrow(z.ZodError);
  });

  it("validates group membership and grant inputs with Zod 4", () => {
    expect(
      createOrganizationGroupInputSchema.parse({
        organizationId: "org",
        name: "Reviewers",
        memberIds: ["user"],
        bindings: [
          {
            role: "CUSTOM",
            customRoleId: "role",
            scopeType: "PROJECT",
            scopeId: "project",
          },
        ],
        actor: { type: "user", id: "actor" },
      }),
    ).toMatchObject({ name: "Reviewers" });
    expect(() =>
      organizationGroupBindingInputSchema.parse({
        role: "OWNER",
        scopeType: "PROJECT",
        scopeId: "project",
      }),
    ).toThrow(z.ZodError);
  });
});
