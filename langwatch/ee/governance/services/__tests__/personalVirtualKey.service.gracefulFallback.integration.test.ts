// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Real-DB integration coverage for the no-default-policy graceful
 * fallback in `PersonalVirtualKeyService.issue`. When the caller
 * relies on default resolution and the org has no `isDefault=true`
 * RoutingPolicy, the service used to throw and the device-flow
 * approval silently bypassed VK minting. Customers with many
 * ModelProviders configured at ORG scope still saw "No personal
 * virtual key on this account" on `langwatch login`.
 *
 * Now: when at least one ModelProvider is reachable from the
 * personal team via scope cascade (PROJECT / TEAM / ORGANIZATION),
 * the VK is minted with `routingPolicyId: null` and the gateway
 * dispatch path falls back to `fallbackPriorityGlobal` ordering.
 * Only when the cascade is empty do we refuse the mint with the
 * actionable `NoEligibleProvidersError`.
 */

import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

import {
  PersonalVirtualKeyService,
  NoEligibleProvidersError,
} from "../personalVirtualKey.service";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;
const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

describe.skipIf(isTestcontainersOnly || !hasCredentialsSecret)(
  "PersonalVirtualKeyService.issue — graceful fallback when no default policy (real DB)",
  () => {
    const service = PersonalVirtualKeyService.create(prisma, {
      gatewayBaseUrl: "http://gw.test",
    });

    let suffix: string;
    let orgId: string;
    let userId: string;
    let teamId: string;
    let projectId: string;

    beforeEach(async () => {
      suffix = nanoid(8);
      orgId = `org-fb-${suffix}`;
      userId = `usr-fb-${suffix}`;
      teamId = `team-fb-${suffix}`;
      projectId = `proj-fb-${suffix}`;

      await prisma.organization.create({
        data: { id: orgId, name: `FB ${suffix}`, slug: `fb-${suffix}` },
      });
      await prisma.user.create({
        data: { id: userId, email: `fb-${suffix}@example.com`, name: "FB User" },
      });
      await prisma.organizationUser.create({
        data: { organizationId: orgId, userId, role: "MEMBER" },
      });
      await prisma.team.create({
        data: {
          id: teamId,
          name: `FB Personal ${suffix}`,
          slug: `fb-personal-${suffix}`,
          organizationId: orgId,
          isPersonal: true,
          ownerUserId: userId,
        },
      });
      await prisma.project.create({
        data: {
          id: projectId,
          name: `FB Project ${suffix}`,
          slug: `fb-project-${suffix}`,
          apiKey: `fb-${suffix}`,
          teamId,
          language: "typescript",
          framework: "other",
          isPersonal: true,
          ownerUserId: userId,
        },
      });
    });

    describe("given an org-scoped ModelProvider exists but no default RoutingPolicy", () => {
      /** @scenario When org has no default RoutingPolicy but has accessible providers, personal-key issuance succeeds with no policy bound */
      it("mints the VK with routingPolicyId=null instead of throwing", async () => {
        const mpId = `mp-fb-${suffix}`;
        await prisma.modelProvider.create({
          data: {
            id: mpId,
            name: `fb-mp-${suffix}`,
            provider: "anthropic",
            enabled: true,
            organizationId: orgId,
            scopes: {
              create: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
            },
          },
        });

        const issued = await service.issue({
          userId,
          organizationId: orgId,
          personalProjectId: projectId,
          personalTeamId: teamId,
          label: "default",
        });

        expect(issued.routingPolicyId).toBeNull();
        expect(issued.virtualKey.id).toBeTruthy();
        expect(issued.secret).toBeTruthy();
      });
    });

    describe("given a default RoutingPolicy with zero providers AND a separately-scoped MP", () => {
      it("falls back to mint with null policy rather than refusing — caller did not pin the empty policy", async () => {
        await prisma.routingPolicy.create({
          data: {
            id: `rp-empty-${suffix}`,
            organizationId: orgId,
            name: `empty-${suffix}`,
            isDefault: true,
            modelProviderIds: [],
            scopes: {
              create: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
            },
          },
        });
        await prisma.modelProvider.create({
          data: {
            id: `mp-fb2-${suffix}`,
            name: `fb-mp2-${suffix}`,
            provider: "openai",
            enabled: true,
            organizationId: orgId,
            scopes: {
              create: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
            },
          },
        });

        const issued = await service.issue({
          userId,
          organizationId: orgId,
          personalProjectId: projectId,
          personalTeamId: teamId,
          label: "default",
        });

        expect(issued.routingPolicyId).toBeNull();
      });
    });

    describe("given the org has zero accessible ModelProviders", () => {
      /** @scenario When org has no AI providers at all, personal-key issuance fails with a clear error */
      it("rejects with NoEligibleProvidersError carrying an actionable message", async () => {
        await expect(
          service.issue({
            userId,
            organizationId: orgId,
            personalProjectId: projectId,
            personalTeamId: teamId,
            label: "default",
          }),
        ).rejects.toBeInstanceOf(NoEligibleProvidersError);
      });
    });
  },
);
