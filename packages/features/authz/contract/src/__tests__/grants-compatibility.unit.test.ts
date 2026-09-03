import { describe, expect, expectTypeOf, it } from "vitest";
import * as contract from "../index";
import {
  type AuthzAttachBindingsInput,
  type AuthzAttachBindingsOutput,
  type AuthzAttachResourceGrantInput,
  type AuthzChangeBindingRoleInput,
  type AuthzDefineRoleInput,
  type AuthzDeleteRoleInput,
  AuthzGrantsService,
  type AuthzOffboardMemberInput,
  type AuthzRevokeBindingsInput,
  type AuthzRevokeBindingsWhereInput,
  type AuthzRevokeBindingsWhereOutput,
  type AuthzRevokeResourceGrantsInput,
  authzAttachBindingsInputSchema,
  authzAttachOutcomeSchema,
  authzAttachResourceGrantInputSchema,
  authzAttachResourceGrantOutputSchema,
  authzBindingFilterSchema,
  authzChangeBindingRoleInputSchema,
  authzChangeBindingRoleOutputSchema,
  authzDefineRoleInputSchema,
  authzDefineRoleOutputSchema,
  authzDeleteRoleInputSchema,
  authzDeleteRoleOutputSchema,
  authzOffboardMemberInputSchema,
  authzOffboardMemberOutputSchema,
  authzRevokeBindingsInputSchema,
  authzRevokeBindingsOutputSchema,
  authzRevokeBindingsWhereInputSchema,
  authzRevokeBindingsWhereOutputSchema,
  authzRevokeResourceGrantsInputSchema,
  authzRevokeResourceGrantsOutputSchema,
} from "../index";

const actor = { type: "user" as const, id: "user_admin" };

describe("AuthzGrantsService compatibility operations", () => {
  it("round-trips every portable input without losing compatibility controls", () => {
    const inputs = [
      [
        authzAttachBindingsInputSchema,
        {
          organizationId: "org_1",
          bindings: [
            {
              bindingId: "binding_1",
              principal: { userId: "user_1" },
              role: "CUSTOM",
              customRoleId: "role_1",
              scopeType: "PROJECT",
              scopeId: "project_1",
            },
          ],
          actor,
          source: "read-through-mint",
          onDuplicate: "skip",
          commandId: "command_1",
          occurredAtMs: 1_700_000_000_000,
          awaitProjection: false,
        },
      ],
      [
        authzAttachResourceGrantInputSchema,
        {
          organizationId: "org_1",
          grantId: "grant_1",
          projectId: "project_1",
          resource: {
            token: "share_token",
            permission: "traces:view",
            kind: "trace",
            expiresAtMs: 1_800_000_000_000,
            maxViews: 10,
            createdByUserId: "user_1",
          },
          principal: { type: "anyone", id: null },
          scopeId: "trace_1",
          actor,
          commandId: "command_2",
        },
      ],
      [
        authzRevokeResourceGrantsInputSchema,
        {
          organizationId: "org_1",
          grantIds: ["grant_1"],
          actor,
          reason: "share deleted",
        },
      ],
      [
        authzChangeBindingRoleInputSchema,
        {
          organizationId: "org_1",
          bindingId: "binding_1",
          role: "MEMBER",
          customRoleId: null,
          actor,
        },
      ],
      [
        authzRevokeBindingsInputSchema,
        {
          organizationId: "org_1",
          bindingIds: ["binding_1", "binding_2"],
          actor,
          reason: "membership removed",
        },
      ],
      [
        authzRevokeBindingsWhereInputSchema,
        {
          organizationId: "org_1",
          where: {
            apiKeyId: "key_1",
            customRoleId: { in: ["role_1", "role_2"] },
            scopeType: "PROJECT",
            scopeId: "project_1",
            id: { notIn: ["binding_keep"] },
          },
          actor,
          reason: "credential retired",
        },
      ],
      [
        authzOffboardMemberInputSchema,
        {
          organizationId: "org_1",
          userId: "user_1",
          revokedGrantIds: ["binding_1"],
          actor,
        },
      ],
      [
        authzDefineRoleInputSchema,
        {
          organizationId: "org_1",
          roleId: "role_1",
          name: "Reviewer",
          description: "May review traces",
          permissions: ["traces:view"],
          kind: "custom",
          actor,
        },
      ],
      [
        authzDeleteRoleInputSchema,
        {
          organizationId: "org_1",
          roleId: "role_1",
          actor,
          awaitProjection: false,
        },
      ],
    ] as const;

    for (const [schema, input] of inputs) {
      expect(schema.parse(input)).toEqual(input);
    }
  });

  it("validates each operation's portable output", () => {
    expect(
      authzAttachOutcomeSchema.parse({
        attached: ["binding_1"],
        duplicates: ["binding_2"],
      }),
    ).toEqual({ attached: ["binding_1"], duplicates: ["binding_2"] });
    // A count is a non-negative integer, which is the only thing this schema
    // decides; `parse(2)).toBe(2)` held for `z.unknown()` too.
    expect(authzRevokeBindingsWhereOutputSchema.safeParse(2).success).toBe(true);
    expect(authzRevokeBindingsWhereOutputSchema.safeParse(-1).success).toBe(false);
    expect(authzRevokeBindingsWhereOutputSchema.safeParse(1.5).success).toBe(false);
    for (const schema of [
      authzAttachResourceGrantOutputSchema,
      authzRevokeResourceGrantsOutputSchema,
      authzChangeBindingRoleOutputSchema,
      authzRevokeBindingsOutputSchema,
      authzOffboardMemberOutputSchema,
      authzDefineRoleOutputSchema,
      authzDeleteRoleOutputSchema,
    ]) {
      expect(schema.parse(undefined)).toBeUndefined();
      expect(schema.safeParse("not void").success).toBe(false);
    }
  });

  it("rejects ambiguous principals and invalid resource audiences", () => {
    expect(
      authzAttachBindingsInputSchema.safeParse({
        organizationId: "org_1",
        bindings: [
          {
            bindingId: "binding_1",
            principal: { userId: "user_1", groupId: "group_1" },
            role: "MEMBER",
            customRoleId: null,
            scopeType: "TEAM",
            scopeId: "team_1",
          },
        ],
        actor,
        onDuplicate: "reject",
      }).success,
    ).toBe(false);
    expect(
      authzAttachResourceGrantInputSchema.safeParse({
        organizationId: "org_1",
        grantId: "grant_1",
        projectId: "project_1",
        resource: {
          token: "token_1",
          permission: "traces:view",
          kind: "trace",
        },
        principal: { type: "anyone", id: "somebody" },
        scopeId: "trace_1",
        actor,
      }).success,
    ).toBe(false);
  });

  it("keeps the selector closed and tenancy exclusively top-level", () => {
    expect(
      authzBindingFilterSchema.safeParse({
        userId: "user_1",
        id: { in: ["binding_1"], not: "binding_2" },
      }).success,
    ).toBe(true);
    expect(authzBindingFilterSchema.safeParse({ organizationId: "org_other" }).success).toBe(false);
    expect(
      authzBindingFilterSchema.safeParse({
        userId: "user_1",
        id: { startsWith: "binding" },
      }).success,
    ).toBe(false);
    expect(
      authzBindingFilterSchema.safeParse({
        userId: "user_1",
        arbitraryDatabaseClause: true,
      }).success,
    ).toBe(false);
  });

  it("rejects invalid business-time, source, role, and wait values", () => {
    const base = {
      organizationId: "org_1",
      bindings: [],
      actor,
      onDuplicate: "skip",
    };
    // Not "migration": that joined GRANT_EVENT_SOURCES in 52980c4405 and the
    // legacy-import migration emits it, so asserting its rejection here made
    // this a test of a vocabulary that had already moved on.
    expect(
      authzAttachBindingsInputSchema.safeParse({
        ...base,
        source: "hand-typed",
      }).success,
    ).toBe(false);
    expect(
      authzAttachBindingsInputSchema.safeParse({
        ...base,
        occurredAtMs: -1,
      }).success,
    ).toBe(false);
    expect(
      authzDefineRoleInputSchema.safeParse({
        organizationId: "org_1",
        roleId: "role_1",
        name: "",
        permissions: [""],
        kind: "operator",
        actor,
      }).success,
    ).toBe(false);
    expect(
      authzDeleteRoleInputSchema.safeParse({
        organizationId: "org_1",
        roleId: "role_1",
        actor,
        awaitProjection: "later",
      }).success,
    ).toBe(false);
  });

  it("declares the nine operations on the one portable capability", () => {
    expect("GrantsLedgerWriter" in contract).toBe(false);
    expectTypeOf<AuthzGrantsService["attachBindings"]>().toEqualTypeOf<
      (args: AuthzAttachBindingsInput) => Promise<AuthzAttachBindingsOutput>
    >();
    expectTypeOf<AuthzGrantsService["attachResourceGrant"]>().toEqualTypeOf<
      (args: AuthzAttachResourceGrantInput) => Promise<void>
    >();
    expectTypeOf<AuthzGrantsService["revokeResourceGrants"]>().toEqualTypeOf<
      (args: AuthzRevokeResourceGrantsInput) => Promise<void>
    >();
    expectTypeOf<AuthzGrantsService["changeBindingRole"]>().toEqualTypeOf<
      (args: AuthzChangeBindingRoleInput) => Promise<void>
    >();
    expectTypeOf<AuthzGrantsService["revokeBindings"]>().toEqualTypeOf<
      (args: AuthzRevokeBindingsInput) => Promise<void>
    >();
    expectTypeOf<AuthzGrantsService["revokeBindingsWhere"]>().toEqualTypeOf<
      (args: AuthzRevokeBindingsWhereInput) => Promise<AuthzRevokeBindingsWhereOutput>
    >();
    expectTypeOf<AuthzGrantsService["offboardMember"]>().toEqualTypeOf<
      (args: AuthzOffboardMemberInput) => Promise<void>
    >();
    expectTypeOf<AuthzGrantsService["defineRole"]>().toEqualTypeOf<
      (args: AuthzDefineRoleInput) => Promise<void>
    >();
    expectTypeOf<AuthzGrantsService["deleteRole"]>().toEqualTypeOf<
      (args: AuthzDeleteRoleInput) => Promise<void>
    >();
  });
});
