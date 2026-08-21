/** @vitest-environment node */

/**
 * The compile-time half of the typed declaration surface (ADR-092
 * delivery-plan decision 25). Every `@ts-expect-error` below IS the
 * assertion: `pnpm typecheck:tests` fails if a declaration the registry
 * forbids starts compiling, or if one it allows stops. The vitest run only
 * proves the surface exists at runtime.
 *
 * specs/rbac/typed-permission-declarations.feature is the behavioural
 * contract these pin.
 */
import type { EndpointConfig } from "@langwatch/api";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkDeclaredPermission } from "~/server/app-layer/authz/trpc-middleware";
import { requires } from "../security";
import { protectedProcedure } from "../trpc";

const projectInput = z.object({ projectId: z.string() });
const teamInput = z.object({ teamId: z.string() });
const organizationInput = z.object({ organizationId: z.string() });

/** @scenario "A declared permission reads its scope from the validated input" */
const projectScoped = protectedProcedure
  .input(projectInput)
  .permission("traces:view");

/** @scenario "The most specific tier the permission allows decides the check scope" */
const mixedScoped = protectedProcedure
  .input(z.object({ projectId: z.string(), organizationId: z.string() }))
  .permission("traces:view");

const organizationScoped = protectedProcedure
  .input(organizationInput)
  .permission("organization:manage");

/** @scenario "An input modelled as a union is checked per member" */
const eitherScoped = protectedProcedure
  .input(
    z.union([
      z.object({ projectId: z.string() }),
      z.object({ organizationId: z.string() }),
    ]),
  )
  .permission("project:update");

/** @scenario "A scope derivation is written at the call site, never inferred" */
const derived = protectedProcedure
  .input(teamInput)
  .permission("organization:manage", { via: "teamId" });

/** @scenario "Any one of several declared permissions is enough" */
const anyOf = protectedProcedure
  .input(projectInput)
  .permissionAny("traces:view", "scenarios:view");

/** @scenario "Opting out of permission checks requires a written reason" */
const optedOut = protectedProcedure
  .input(z.object({ name: z.string() }))
  .noPermission({ reason: "user-scoped data only" });

const optedOutWithAllowance = protectedProcedure
  .input(organizationInput)
  .noPermission({
    reason: "creation flow",
    allow: { organizationId: "the organization being created into" },
  });

/** @scenario "A service-authorized procedure declares the permissions its service enforces" */
const serviceAuthorized = protectedProcedure
  .input(z.object({ rowId: z.string() }))
  .authorizeInService({
    reason: "the row's own scope set decides at runtime",
    permissions: ["traces:view"],
  });

// ---------------------------------------------------------------------------
// The refusals. Each @ts-expect-error is load-bearing.
// ---------------------------------------------------------------------------

/** @scenario "An input id from a tier the permission cannot be granted at fails to compile" */
// @ts-expect-error — governance is organization-only; a projectId input is a category error
protectedProcedure.input(projectInput).permission("governance:view");

// @ts-expect-error — organization:manage is organization-only; from a team input it needs { via: "teamId" }
protectedProcedure.input(teamInput).permission("organization:manage");

/** @scenario "Declaring a permission with no usable scope id in the input fails to compile" */
protectedProcedure
  .input(z.object({ name: z.string() }))
  // @ts-expect-error — the input carries no projectId, teamId, or organizationId
  .permission("traces:view");

protectedProcedure
  .input(z.object({ projectId: z.string().optional() }))
  // @ts-expect-error — an optional id is not a guarantee the runtime can rely on
  .permission("traces:view");

// @ts-expect-error — .input() must come first: the check reads its scope id from it
protectedProcedure.permission("traces:view");

// @ts-expect-error — "team:delete" is not a registry permission (manage implies delete)
protectedProcedure.input(teamInput).permission("team:delete");

/** @scenario "A platform-tier permission is refused by the scoped declaration surface" */
// @ts-expect-error — ops is platform-tier; the operator middleware owns it
protectedProcedure.input(organizationInput).permission("ops:view");

protectedProcedure
  .input(teamInput)
  // @ts-expect-error — via must name a field the input actually requires
  .permission("organization:manage", { via: "projectId" });

protectedProcedure
  .input(teamInput)
  // @ts-expect-error — via exists for tiers the input cannot satisfy directly; traces:view already accepts teamId
  .permission("traces:view", { via: "teamId" });

protectedProcedure
  .input(organizationInput)
  // @ts-expect-error — permissionAny checks at the project scope; this input has no projectId
  .permissionAny("traces:view", "scenarios:view");

/** @scenario "An opted-out procedure cannot silently read scoped input" */
protectedProcedure
  .input(projectInput)
  // @ts-expect-error — the input carries projectId; it must be individually allowed with a reason
  .noPermission({ reason: "nothing scoped" });

protectedProcedure
  .input(z.object({ projectId: z.string(), organizationId: z.string() }))
  .noPermission({
    reason: "creation flow",
    // @ts-expect-error — allow must cover every scope id the input carries
    allow: { organizationId: "creating into this organization" },
  });

describe("typed permission declarations", () => {
  describe("when the declarations above compile", () => {
    // Each `it` below vouches for a compile-time assertion in this file: the
    // valid declaration it names built a procedure, and the matching
    // `@ts-expect-error` above it is enforced by `pnpm typecheck:tests`.

    /** @scenario "A declared permission reads its scope from the validated input" */
    it("builds a procedure from a project-scoped declaration", () => {
      expect(projectScoped).toBeDefined();
      expect(mixedScoped).toBeDefined();
      expect(organizationScoped).toBeDefined();
    });

    /** @scenario "An input id from a tier the permission cannot be granted at fails to compile" */
    it("refuses an organization-only permission on a project-only input", () => {
      // The assertion is the `@ts-expect-error` on the governance declaration
      // above; this vouches the valid neighbour still compiles.
      expect(organizationScoped).toBeDefined();
    });

    /** @scenario "A platform-tier permission is refused by the scoped declaration surface" */
    it("refuses ops permissions on the scoped surface", () => {
      // The assertion is the `@ts-expect-error` on the ops:view declaration.
      expect(true).toBe(true);
    });

    /** @scenario "An input modelled as a union is checked per member" */
    it("builds a procedure from a union input", () => {
      expect(eitherScoped).toBeDefined();
    });

    /** @scenario "A route policy cannot name a permission outside the registry" */
    it("holds the HTTP route policies to the same vocabulary", () => {
      expect(requires("traces:view")).toEqual({
        kind: "permission",
        permission: "traces:view",
      });
      // @ts-expect-error — traces cannot be rotated; the registry makes it unsayable
      void requires("traces:rotate");
      // @ts-expect-error — the legacy cross product is retired on this surface too
      void requires("team:delete");
    });

    it("builds the derivation, any-of, opt-out and service-authorized shapes", () => {
      for (const procedure of [
        derived,
        anyOf,
        optedOut,
        optedOutWithAllowance,
        serviceAuthorized,
      ]) {
        expect(procedure).toBeDefined();
      }
    });
  });

  describe("given a custom middleware on the pending builder", () => {
    /** @scenario "A hand-rolled procedure middleware cannot claim a permission check" */
    it("accepts only middleware that declares its policy", () => {
      const declared = protectedProcedure
        .input(projectInput)
        .use(checkDeclaredPermission({ permission: "traces:view" }));

      const handRolled = protectedProcedure
        .input(projectInput)
        // @ts-expect-error — a bare function carries no declaration; flipping permissionChecked by hand does not compile
        .use(async ({ ctx, next }: { ctx: { permissionChecked: boolean }; next: () => Promise<unknown> }) => {
          ctx.permissionChecked = true;
          return next();
        });

      expect(declared).toBeDefined();
      expect(handRolled).toBeDefined();
    });
  });

  describe("given a @langwatch/api service endpoint", () => {
    /**
     * The framework side of the same contract: an endpoint config carries
     * exactly one of a registry permission or a written opt-out
     * (AccessDeclaration, @langwatch/authz). `build()` re-checks at boot.
     */
    /** @scenario "A service endpoint that declares no access fails to compile" */
    it("cannot be configured without an access declaration", () => {
      const declared: EndpointConfig = { permission: "organization:manage" };
      const optedOutEndpoint: EndpointConfig = {
        noPermission: { reason: "health probe; response carries no data" },
      };
      // @ts-expect-error — an endpoint declaring neither a permission nor an opt-out does not compile
      const bare: EndpointConfig = { description: "no access declaration" };
      // @ts-expect-error — declaring both is as wrong as declaring neither
      const both: EndpointConfig = {
        permission: "organization:manage",
        noPermission: { reason: "contradiction" },
      };
      // @ts-expect-error — the permission vocabulary is the registry's, here too
      const offRegistry: EndpointConfig = { permission: "traces:rotate" };

      for (const config of [declared, optedOutEndpoint, bare, both, offRegistry]) {
        expect(config).toBeDefined();
      }
    });
  });
});
