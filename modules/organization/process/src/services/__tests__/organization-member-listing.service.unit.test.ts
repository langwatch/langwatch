/**
 * @vitest-environment node
 * The organization:list-member-facts step: each active membership listed as organization's fact,
 * disabled members and deactivated users left out, keyed so a rerun records nothing new.
 * Spec: modules/organization/specs/organization-service.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { RecordMemberListedCommand } from "../../eventing/organization-lifecycle.commands.ts";
import type { RecordMemberListedCommandData } from "../../eventing/organization-lifecycle.events.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../../repositories/memory/memory.organization.repository.ts";
import { OrganizationMemberListingService } from "../organization-member-listing.service.ts";
import { OrganizationPageBackfillService } from "../organization-page-backfill.service.ts";

const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);
const ADA_JOINED = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2025, 2, 1, 9));
const LINUS_JOINED = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2025, 5, 1, 9));

let memory: MemoryOrganizationDatabase;

function organization(id: string): void {
  memory.organizations.set(id, {
    id,
    name: id,
    slug: id,
    supportContact: null,
    presenceEnabled: true,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  });
}

function member({
  organizationId,
  userId,
  joinedAt = EPOCH,
  disabled = false,
  deactivated = false,
}: {
  organizationId: string;
  userId: string;
  joinedAt?: Instant;
  disabled?: boolean;
  deactivated?: boolean;
}): void {
  memory.users.set(userId, {
    id: userId,
    name: userId,
    email: `${userId}@acme.test`,
    deactivatedAt: deactivated ? EPOCH : null,
  });
  memory.organizationUsers.push({
    userId,
    organizationId,
    role: OrganizationUserRole.MEMBER,
    disabledAt: disabled ? EPOCH : null,
    createdAt: joinedAt,
    updatedAt: joinedAt,
  });
}

/** The listing over the memory store, recording every batch it sends. */
function listing() {
  const batches: RecordMemberListedCommandData[][] = [];
  const service = OrganizationMemberListingService.create({
    organizations: MemoryOrganizationRepository.create({ memory }),
  });
  service.connect({
    recordMemberListed: {
      sendBatch: async (batch) => {
        batches.push([...batch]);
      },
    },
  });
  return { service, batches };
}

/** The step as organization.module.ts composes it: the page walk over the listing's pages. */
function runStep(service: OrganizationMemberListingService, { dryRun = false } = {}) {
  return OrganizationPageBackfillService.create({
    peers: {
      page: async (input) => {
        const { listed, ...page } = await service.listPage(input);
        return { ...page, changed: listed };
      },
    },
    pageSize: 1,
  }).backfill({
    after: undefined,
    dryRun,
    signal: new AbortController().signal,
    onPage: async () => {},
  });
}

/** What the event log keeps: the facts' keys, as the command records them. */
function keysOf(batches: readonly RecordMemberListedCommandData[][]): string[] {
  return batches.flat().map((data) => {
    const [event] = new RecordMemberListedCommand().handle({
      tenantId: createTenantId(data.tenantId),
      aggregateId: data.organizationId,
      type: RecordMemberListedCommand.schema.type,
      data,
    });
    return event?.idempotencyKey ?? "";
  });
}

beforeEach(() => {
  memory = MemoryOrganizationDatabase.create();
  organization("org_acme");
  organization("org_beta");
  organization("org_empty");
  member({ organizationId: "org_acme", userId: "ada", joinedAt: ADA_JOINED });
  member({ organizationId: "org_acme", userId: "grace", deactivated: true });
  member({ organizationId: "org_acme", userId: "mallory", disabled: true });
  member({ organizationId: "org_beta", userId: "linus", joinedAt: LINUS_JOINED });
});

describe("given organizations with active, disabled and deactivated members", () => {
  describe("when the member listing step runs", () => {
    /** @scenario "Existing active members are listed as organization's facts by the member listing step" */
    it("sends one fact per active membership, with when it joined, marked backfilled", async () => {
      const { service, batches } = listing();

      const report = await runStep(service);

      expect(batches.flat()).toEqual([
        expect.objectContaining({
          tenantId: "org_acme",
          organizationId: "org_acme",
          userId: "ada",
          joinedAt: ADA_JOINED.epochMilliseconds,
          backfilled: true,
        }),
        expect.objectContaining({
          tenantId: "org_beta",
          organizationId: "org_beta",
          userId: "linus",
          joinedAt: LINUS_JOINED.epochMilliseconds,
          backfilled: true,
        }),
      ]);
      expect(report).toEqual({ afterOrganizationId: "org_empty", organizations: 3, changed: 2 });
    });

    /** @scenario "Existing active members are listed as organization's facts by the member listing step" */
    it("sends nothing for the disabled member or the deactivated user", async () => {
      const { service, batches } = listing();

      await runStep(service);

      expect(batches.flat().map(({ userId }) => userId)).not.toContain("mallory");
      expect(batches.flat().map(({ userId }) => userId)).not.toContain("grace");
    });

    it("sends no batch for an organization with no active member", async () => {
      const { service, batches } = listing();

      await runStep(service);

      expect(batches).toHaveLength(2);
    });
  });

  describe("when the member listing step runs again", () => {
    /** @scenario "Re-running the member listing step records nothing new" */
    it("sends the same facts under the same keys, so the rerun records nothing new", async () => {
      const first = listing();
      await runStep(first.service);
      const rerun = listing();
      await runStep(rerun.service);

      expect(keysOf(first.batches)).toEqual([
        "org_acme:ada:member_listed",
        "org_beta:linus:member_listed",
      ]);
      expect(keysOf(rerun.batches)).toEqual(keysOf(first.batches));
    });
  });

  describe("when the member listing step runs as a dry run", () => {
    /** @scenario "A dry run of the member listing step counts what it would list and records nothing" */
    it("sends nothing and counts the facts a real run sends", async () => {
      const { service, batches } = listing();

      const report = await runStep(service, { dryRun: true });

      expect(batches).toEqual([]);
      expect(report.changed).toBe(2);
    });
  });

  describe("when organization_lifecycle is not registered in this process", () => {
    it("throws, so the step retries the page", async () => {
      const service = OrganizationMemberListingService.create({
        organizations: MemoryOrganizationRepository.create({ memory }),
      });

      await expect(
        service.listPage({ afterOrganizationId: null, limit: 10, dryRun: false }),
      ).rejects.toThrow("organization_lifecycle is not registered in this process");
    });
  });
});
