/**
 * @vitest-environment node
 *
 * Parity between the two resolvers that answer "which providers can this key
 * reach through its scope": the server's `scopeReachableModelProvidersForVk`
 * (what a key's provider allowlist may name) and the client-side
 * `resolveEligible` the virtual-key drawers render (what the user may pick
 * before issuing the key). Both are scope-only: a routing policy narrows the
 * DISPATCH set (`eligibleModelProvidersForVk`), never the allowlist.
 *
 * The drawer resolver is a second implementation of the same rule, fed by
 * `listOrgModelProvidersForFrontend`. Any filter present on one side and
 * missing on the other silently widens what a key appears to reach:
 * a withdrawn credential still advertised as routable is a governance hole,
 * not a stale count. This test drives BOTH sides off the same real Postgres
 * rows and asserts they agree, so the drift cannot come back.
 *
 * Hits real PG - NO MOCKS.
 *
 * Spec: specs/ai-gateway/governance/vk-scope-inheritance.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildScopeHierarchy,
  type OrgModelProvider,
  resolveEligible,
} from "~/components/gateway/eligibleModelProviders";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { ModelProviderService } from "~/server/modelProviders/modelProvider.service";
import {
  eligibleModelProvidersForVk,
  scopeReachableModelProvidersForVk,
} from "../scopeResolver";
import { VirtualKeyRepository } from "../virtualKey.repository";

const suffix = nanoid(8);
const ORG_ID = `org-elig-${suffix}`;
const TEAM_ID = `team-elig-${suffix}`;
const PROJECT_ID = `proj-elig-${suffix}`;
const SIBLING_PROJECT_ID = `proj-elig-sib-${suffix}`;
const USER_ID = `usr-elig-${suffix}`;
const VK_ID = `vk-elig-${suffix}`;

const MP_ORG_ID = `mp-elig-org-${suffix}`;
const MP_ORG_OFF_ID = `mp-elig-org-off-${suffix}`;
const MP_ORG_WITHDRAWN_ID = `mp-elig-org-withdrawn-${suffix}`;
const MP_PROJECT_ID = `mp-elig-project-${suffix}`;
const MP_SIBLING_ID = `mp-elig-sibling-${suffix}`;
const MP_MULTISCOPE_ID = `mp-elig-multiscope-${suffix}`;

const RP_ID = `rp-elig-${suffix}`;
const VK_POLICY_ID = `vk-elig-policy-${suffix}`;
// The routing policy lists a strict subset of the set a project key reaches
// ({ORG, MULTISCOPE, PROJECT}): it leaves MULTISCOPE out. The gateway
// intersects the DISPATCH set with this list, so MULTISCOPE never dispatches.
// It stays scope-reachable, so it is still savable in the key's allowlist.
const RP_PROVIDER_IDS = [MP_ORG_ID, MP_PROJECT_ID];

/**
 * Mirrors what `VirtualKeyCreateDrawer` hands the preview: the org-wide
 * provider list straight off the tRPC query, plus the org/team/project
 * graph the picker already has in memory.
 *
 * The plain annotation below is doing work. Assigning the service's return
 * value straight into `OrgModelProvider[]` is what makes the compiler check
 * that the two sides still agree on the shape, which is the whole point of
 * this file: `isRoutable` reads `enabled` and `disabledAt`, and a drawer
 * reading fields the service stopped sending is exactly the bug here. An
 * `as unknown as` cast would satisfy the compiler while the two halves
 * diverged, so this test would keep passing through the regression it exists
 * to catch. If a future change makes this line fail to compile, fix the
 * types rather than casting past them.
 */
async function resolveAsTheDrawerWould() {
  const service = ModelProviderService.create(prisma);
  const providers: OrgModelProvider[] =
    await service.listOrgModelProvidersForFrontend(ORG_ID);
  const hierarchy = buildScopeHierarchy(
    [
      { id: PROJECT_ID, teamId: TEAM_ID },
      { id: SIBLING_PROJECT_ID, teamId: TEAM_ID },
    ],
    ORG_ID,
  );
  return resolveEligible({
    scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
    providers,
    hierarchy,
  });
}

describe("eligible model providers - drawer / gateway parity on real PG", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `Elig Org ${suffix}`, slug: `elig-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Elig Team ${suffix}`,
        slug: `elig-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    for (const [id, slug] of [
      [PROJECT_ID, `elig-proj-${suffix}`],
      [SIBLING_PROJECT_ID, `elig-sib-${suffix}`],
    ] as const) {
      await prisma.project.create({
        data: {
          id,
          name: id,
          slug,
          teamId: TEAM_ID,
          language: "en",
          framework: "openai",
          apiKey: `key-${slug}`,
        },
      });
    }
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@elig.local`, name: "Elig" },
    });

    const mp = (
      id: string,
      name: string,
      scopes: Array<{
        scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
        scopeId: string;
      }>,
      overrides: { enabled?: boolean; disabledAt?: Date } = {},
    ) =>
      prisma.modelProvider.create({
        data: {
          id,
          name,
          provider: "openai",
          enabled: overrides.enabled ?? true,
          disabledAt: overrides.disabledAt ?? null,
          organizationId: ORG_ID,
          // A stored row only survives the settings-list projection when it
          // customises something; a credential is the realistic case.
          customKeys: { OPENAI_API_KEY: `sk-test-${id}` },
          scopes: { create: scopes },
        },
      });

    await mp(MP_ORG_ID, "Central OpenAI", [
      { scopeType: "ORGANIZATION", scopeId: ORG_ID },
    ]);
    await mp(
      MP_ORG_OFF_ID,
      "Switched Off OpenAI",
      [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      { enabled: false },
    );
    await mp(
      MP_ORG_WITHDRAWN_ID,
      "Withdrawn OpenAI",
      [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      { disabledAt: new Date("2026-07-01T00:00:00Z") },
    );
    await mp(MP_PROJECT_ID, "Project OpenAI", [
      { scopeType: "PROJECT", scopeId: PROJECT_ID },
    ]);
    await mp(MP_SIBLING_ID, "Sibling OpenAI", [
      { scopeType: "PROJECT", scopeId: SIBLING_PROJECT_ID },
    ]);
    await mp(MP_MULTISCOPE_ID, "Everywhere OpenAI", [
      { scopeType: "ORGANIZATION", scopeId: ORG_ID },
      { scopeType: "TEAM", scopeId: TEAM_ID },
      { scopeType: "PROJECT", scopeId: PROJECT_ID },
    ]);

    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: `elig-${suffix}`,
        hashedSecret: "hash",
        displayPrefix: "vk-lw-elig",
        createdById: USER_ID,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });

    await prisma.routingPolicy.create({
      data: {
        id: RP_ID,
        organizationId: ORG_ID,
        name: `Elig Policy ${suffix}`,
        modelProviderIds: RP_PROVIDER_IDS,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_POLICY_ID,
        organizationId: ORG_ID,
        name: `elig-policy-${suffix}`,
        hashedSecret: "hash-policy",
        displayPrefix: "vk-lw-elig-p",
        createdById: USER_ID,
        routingMode: "POLICY",
        routingPolicyId: RP_ID,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.routingPolicy.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.modelProvider.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await stopTestContainers();
  }, 120_000);

  describe("given providers that an admin switched off or withdrew", () => {
    /** @scenario A provider an admin turned off is not offered to a new key */
    it("keeps a switched-off provider out of the gateway's eligible set", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const ids = (await eligibleModelProvidersForVk(prisma, vk!)).map((p) => p.id);

      expect(ids).not.toContain(MP_ORG_OFF_ID);
      expect(ids).not.toContain(MP_ORG_WITHDRAWN_ID);
    });

    /** @scenario A provider an admin removed is not offered to a new key */
    it("keeps them out of what the drawer offers too", async () => {
      const ids = (await resolveAsTheDrawerWould()).map((p) => p.id);

      expect(ids).not.toContain(MP_ORG_OFF_ID);
      expect(ids).not.toContain(MP_ORG_WITHDRAWN_ID);
    });
  });

  describe("given a key scoped to one project of the organization", () => {
    /** @scenario The drawer and the gateway agree on which providers are routable */
    it("resolves the same provider set on both sides", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const reachableIds = (await scopeReachableModelProvidersForVk(prisma, vk!))
        .map((p) => p.id)
        .sort();
      const drawerIds = (await resolveAsTheDrawerWould()).map((p) => p.id).sort();

      expect(drawerIds).toEqual(reachableIds);
      expect(drawerIds).toEqual([MP_ORG_ID, MP_MULTISCOPE_ID, MP_PROJECT_ID].sort());
    });

    it("never reaches a sibling project's provider", async () => {
      const ids = (await resolveAsTheDrawerWould()).map((p) => p.id);

      expect(ids).not.toContain(MP_SIBLING_ID);
    });
  });

  describe("given a provider attached at several scopes the key reaches", () => {
    /** @scenario The same provider is never listed twice */
    it("lists it exactly once", async () => {
      const ids = (await resolveAsTheDrawerWould()).map((p) => p.id);

      expect(ids.filter((id) => id === MP_MULTISCOPE_ID)).toHaveLength(1);
      expect(new Set(ids).size).toBe(ids.length);
    });

    /** @scenario A provider reachable through several tiers is attributed to the broadest one */
    it("attributes it to the organization, the broadest scope it lives at", async () => {
      const row = (await resolveAsTheDrawerWould()).find(
        (p) => p.id === MP_MULTISCOPE_ID,
      );

      expect(row?.definedAt).toEqual({
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      });
    });
  });

  describe("given an organization-wide provider inherited by a project key", () => {
    /** @scenario An org-scoped provider inherited into a project is attributed to the organization */
    it("attributes it to the organization, not to the key's project", async () => {
      const row = (await resolveAsTheDrawerWould()).find((p) => p.id === MP_ORG_ID);

      expect(row?.definedAt).toEqual({
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      });
    });

    it("still attributes a project-scoped provider to that project", async () => {
      const row = (await resolveAsTheDrawerWould()).find((p) => p.id === MP_PROJECT_ID);

      expect(row?.definedAt).toEqual({
        scopeType: "PROJECT",
        scopeId: PROJECT_ID,
      });
    });
  });

  describe("given a key on a routing policy that omits a reachable provider", () => {
    /** @scenario A scope-reachable provider can be allowed on a key even when the routing policy omits it */
    it("keeps the omitted provider savable (scope-reachable + drawer) but out of dispatch", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_POLICY_ID, ORG_ID);

      // The scope-reachable set (allowlist validation + drawer) ignores the
      // policy, so the multi-scope provider the policy omits stays in it.
      const reachableIds = (await scopeReachableModelProvidersForVk(prisma, vk!))
        .map((p) => p.id)
        .sort();
      // The dispatch set (materialiser) applies the policy, so the omitted
      // provider is excluded from what the gateway routes to.
      const dispatchIds = (await eligibleModelProvidersForVk(prisma, vk!))
        .map((p) => p.id)
        .sort();

      const service = ModelProviderService.create(prisma);
      const providers: OrgModelProvider[] =
        await service.listOrgModelProvidersForFrontend(ORG_ID);
      const hierarchy = buildScopeHierarchy(
        [
          { id: PROJECT_ID, teamId: TEAM_ID },
          { id: SIBLING_PROJECT_ID, teamId: TEAM_ID },
        ],
        ORG_ID,
      );
      const drawerIds = resolveEligible({
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        providers,
        hierarchy,
      })
        .map((p) => p.id)
        .sort();

      // The drawer offers exactly the scope-reachable set: the policy never
      // narrows what a key's provider allowlist may hold.
      expect(drawerIds).toEqual(reachableIds);
      // The policy-omitted provider stays offered, so it is savable ...
      expect(reachableIds).toContain(MP_MULTISCOPE_ID);
      expect(drawerIds).toContain(MP_MULTISCOPE_ID);
      // ... but the gateway's dispatch set excludes it: blocked at dispatch,
      // not at save.
      expect(dispatchIds).not.toContain(MP_MULTISCOPE_ID);
    });
  });
});
