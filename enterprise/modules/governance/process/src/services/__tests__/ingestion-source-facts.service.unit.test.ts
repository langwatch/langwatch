// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * A source's created and went-live facts, through the source service over the memory source
 * store, to what governance's pipeline senders were handed.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import type { IngestionSourceFactData } from "@langwatch/enterprise-governance-contract/ingestion-source-lifecycle";
import type {
  InternalProject,
  InternalProjectQuery,
  ProjectApi,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryOttlTransformChannel } from "../../channels/memory/memory.ottl-transform.channel.ts";
import { MemoryProviderAccountChannel } from "../../channels/memory/memory.provider-account.channel.ts";
import { PullDestinationService } from "../../features/ingestion-pull/services/pull-destination.service.ts";
import { IngestionSourceFactsService } from "../../features/ingestion-source/services/ingestion-source-facts.service.ts";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../../features/ingestion-source/services/ingestion-source-secret.service.ts";
import { IngestionSourceService } from "../../features/ingestion-source/services/ingestion-source.service.ts";
import { MemoryIngestionSourceRepository } from "../../repositories/memory/memory.ingestion-source.repository.ts";

const CREATED_AT = Date.parse("2026-11-24T10:00:00.000Z");
const STAMPED_AT = Date.parse("2026-11-24T10:05:00.000Z");
const LATER_AT = Date.parse("2026-11-24T10:09:00.000Z");

/** A pipeline sender that keeps what it was handed, or refuses it. */
class RecordingSender {
  readonly sent: IngestionSourceFactData[] = [];
  refusing = false;

  async send(data: IngestionSourceFactData): Promise<void> {
    if (this.refusing) throw new Error("the queue refused the record");
    this.sent.push(data);
  }
}

function governanceProjects(): ProjectApi {
  return createApiFixture<ProjectApi>(
    {
      ensureInternal: (_input: InternalProjectQuery): Promise<InternalProject> =>
        Promise.resolve({
          id: "gov-project",
          name: "Governance (internal)",
          slug: "governance-org",
          teamId: "team",
          kind: "internal_governance",
          archivedAtMs: null,
          traceSharingEnabled: false,
        }),
    },
    "ProjectApi",
  );
}

function harness() {
  let now = CREATED_AT;
  const repository = MemoryIngestionSourceRepository.create({ now: () => now });
  const created = new RecordingSender();
  const wentLive = new RecordingSender();
  const reported: unknown[] = [];
  const facts = IngestionSourceFactsService.create({
    reportError: (error) => void reported.push(error),
  });
  facts.connect({
    recordIngestionSourceCreated: created,
    recordIngestionSourceWentLive: wentLive,
  });
  const service = IngestionSourceService.create({
    repository,
    projects: governanceProjects(),
    entitlements: { hasEnterprisePlan: async () => true },
    lifecycle: { sync: async () => undefined },
    secrets: IngestionSecretService.create(
      IngestionSecretConfiguration.create({ pepper: "pepper" }),
    ),
    destinations: PullDestinationService.create(),
    providerAccounts: MemoryProviderAccountChannel.create(),
    diagnostics: { warn: () => undefined },
    ottl: MemoryOttlTransformChannel.create(),
    facts,
    now: () => now,
  });
  const createSource = async () => {
    const { source } = await service.createSource({
      organizationId: "org-1",
      sourceType: "otel_generic",
      name: "OTel",
      actorUserId: "user-admin",
      parserConfig: {},
    });
    now = STAMPED_AT;
    return source;
  };
  /** Moves the clock the next stamp reads. */
  const clockAt = (at: number) => {
    now = at;
  };
  return { service, repository, created, wentLive, reported, createSource, clockAt };
}

describe("an ingestion source's lifecycle facts", () => {
  describe("when an admin creates a source", () => {
    /** @scenario "Creating a source records that it was created" */
    it("records ingestion_source_created naming the source, its type and the admin", async () => {
      const { created, wentLive, createSource } = harness();

      const source = await createSource();

      expect(created.sent).toEqual([
        {
          tenantId: "org-1",
          organizationId: "org-1",
          sourceId: source.id,
          sourceType: "otel_generic",
          actorUserId: "user-admin",
          occurredAt: CREATED_AT,
        },
      ]);
      expect(wentLive.sent).toEqual([]);
    });
  });

  describe("given a source still awaiting its first event", () => {
    /** @scenario "A source's first data records that it went live, once" */
    it("records ingestion_source_went_live once, to the source's creator", async () => {
      const { service, wentLive, createSource } = harness();
      const source = await createSource();

      await service.recordEventReceived(source);
      await service.recordEventReceived(source);

      expect(wentLive.sent).toEqual([
        {
          tenantId: "org-1",
          organizationId: "org-1",
          sourceId: source.id,
          sourceType: "otel_generic",
          actorUserId: "user-admin",
          occurredAt: STAMPED_AT,
        },
      ]);
    });
  });

  describe("given a source that has taken data", () => {
    /** @scenario "A batch on a source already live records no lifecycle fact" */
    it("records nothing more and still moves the last event time", async () => {
      const { service, repository, created, wentLive, createSource, clockAt } = harness();
      const source = await createSource();
      await service.recordEventReceived(source);
      const factsBefore = created.sent.length + wentLive.sent.length;
      clockAt(LATER_AT);

      await service.recordEventReceived(source);

      expect(created.sent.length + wentLive.sent.length).toBe(factsBefore);
      const stored = await repository.findById(source.id);
      expect(stored?.status).toBe("active");
      expect(stored?.lastEventAt).toEqual(new Date(LATER_AT));
    });
  });

  describe("given the admin disabled the source before its first data", () => {
    /** @scenario "A batch on a disabled source records no lifecycle fact" */
    it("records no went-live fact and leaves the source disabled", async () => {
      const { service, repository, wentLive, createSource } = harness();
      const source = await createSource();
      await repository.update(source.id, { status: "disabled" });

      // The batch was let in on the source as read before the disable.
      await service.recordEventReceived(source);

      expect(wentLive.sent).toEqual([]);
      expect((await repository.findById(source.id))?.status).toBe("disabled");
    });
  });

  describe("when the pipeline refuses every record", () => {
    /** @scenario "A lifecycle fact that is not recorded never fails the create or the batch" */
    it("creates and stamps the source, and reports each refusal", async () => {
      const { service, repository, created, wentLive, reported, createSource } = harness();
      created.refusing = true;
      wentLive.refusing = true;

      const source = await createSource();
      await service.recordEventReceived(source);

      expect((await repository.findById(source.id))?.status).toBe("active");
      await vi.waitFor(() => expect(reported).toHaveLength(2));
    });

    /** @scenario "A lifecycle fact that is not recorded never fails the create or the batch" */
    it("reports, not throws, when the pipeline is not registered in this process", async () => {
      const reported: unknown[] = [];
      const facts = IngestionSourceFactsService.create({
        reportError: (error) => void reported.push(error),
      });
      const { createSource } = harness();
      const source = await createSource();

      facts.created(source);

      expect(reported).toEqual([
        new Error("governance_ingestion_source is not registered in this process"),
      ]);
    });
  });
});
