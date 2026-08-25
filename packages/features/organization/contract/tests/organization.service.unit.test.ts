import {
  claimOrganizationBillingCustomerInputSchema,
  addOrganizationTeamMemberInputSchema,
  createOrganizationTeamInputSchema,
  getOldestTeamInputSchema,
  createOrganizationGroupInputSchema,
  organizationGroupBindingInputSchema,
  organizationBillingProfileSchema,
  type OrganizationService,
} from "../src";
import { describe, expect, it } from "vitest";

describe("OrganizationService contract", () => {
  it("requires a non-empty organization id", () => {
    expect(() =>
      getOldestTeamInputSchema.parse({ organizationId: "" }),
    ).toThrow();
  });

  it("exposes a required non-null team lookup", () => {
    const service = null as unknown as OrganizationService;
    type Result = Awaited<ReturnType<typeof service.getOldestTeamId>>;
    const acceptsString = (_value: Result): void => undefined;
    acceptsString("team");
    expect(true).toBe(true);
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
    ).toThrow();
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
    ).toThrow();
    expect(() =>
      createOrganizationTeamInputSchema.parse({
        organizationId: "org",
        name: "",
      }),
    ).toThrow();
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
    ).toThrow();
  });
});
