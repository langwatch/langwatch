import { describe, expect, expectTypeOf, it } from "vitest";
import * as contract from "../src/index";
import {
  ALL_PERMISSIONS,
  type Authorized,
  BlankScopeIdError,
  authzDecisionSchema,
  authzOffboardInputSchema,
  authzPermissionSchema,
  authzPrincipalRefSchema,
  authzScopeRefSchema,
  attachGrantCommandDataSchema,
  grantAttachedPayloadSchema,
} from "../src/index";

describe("the portable AuthZ contract", () => {
  it("validates principals, scopes, and decisions without server types", () => {
    const principal = authzPrincipalRefSchema.parse({
      type: "user",
      id: "user_1",
    });
    const scope = authzScopeRefSchema.parse({
      type: "project",
      id: "project_1",
      teamId: "team_1",
      organizationId: "organization_1",
    });

    expect(
      authzDecisionSchema.parse({
        allowed: true,
        permission: "traces:view",
        scope,
        principal,
        via: "binding",
        audience: "member",
      }),
    ).toMatchObject({ allowed: true, permission: "traces:view" });
  });

  it("derives runtime permission validation from the append-only registry", () => {
    expect(authzPermissionSchema.options).toEqual(ALL_PERMISSIONS);
    expect(authzPermissionSchema.safeParse("traces:view").success).toBe(true);
    expect(authzPermissionSchema.safeParse("traces:rotate").success).toBe(false);
  });

  it("keeps tenant identity and grant shape invariants at command boundaries", () => {
    const grant = {
      grantId: "grant_1",
      principal: { type: "user" as const, id: "user_1" },
      roleKey: "member",
      scope: { type: "PROJECT" as const, id: "project_1" },
      source: "grants-service" as const,
      actor: { type: "user" as const, id: "user_2" },
      occurredAtMs: 1,
    };

    expect(
      attachGrantCommandDataSchema.safeParse({
        tenantId: "organization_1",
        organizationId: "organization_2",
        commandId: "command_1",
        grant,
      }).success,
    ).toBe(false);
    const { occurredAtMs: _occurredAtMs, ...eventGrant } = grant;
    expect(
      grantAttachedPayloadSchema.safeParse({
        ...eventGrant,
        principal: { type: "anyone", id: null },
        actor: { type: "system", id: null },
      }).success,
    ).toBe(false);
  });

  it("accepts the authenticated system actor that performs SCIM offboarding", () => {
    expect(
      authzOffboardInputSchema.parse({
        actor: { type: "system", name: "scim" },
        userId: "user_1",
        organizationId: "organization_1",
      }).actor,
    ).toEqual({ type: "system", name: "scim" });
  });

  it("exports only the opaque witness type, never a public mint function", () => {
    expect("mintWitness" in contract).toBe(false);
    expectTypeOf<Authorized<"project", "traces:view">>().toMatchTypeOf<{
      readonly permission: "traces:view";
      readonly scope: { readonly tier: "project"; readonly id: string };
    }>();

    // @ts-expect-error the private brand prevents callers from forging proof
    const forged: Authorized<"project", "traces:view"> = {
      permission: "traces:view",
      scope: { tier: "project", id: "project_1" },
    };
    expect(forged.scope.id).toBe("project_1");
  });

  it("keeps blank scope ids in the established customer-correctable error envelope", () => {
    const error = new BlankScopeIdError({ field: "projectId" });

    expect(error).toMatchObject({
      code: "validation_error",
      message: "The request did not name a scope to act in.",
      fault: "customer",
      httpStatus: 400,
      meta: { fieldErrors: { projectId: ["Required"] } },
    });
  });
});
