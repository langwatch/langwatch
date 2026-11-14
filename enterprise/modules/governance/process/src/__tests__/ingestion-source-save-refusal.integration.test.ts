/**
 * @vitest-environment node
 */
// A pull config its adapter refuses never becomes a row. Spec: edit-pull-source-config.feature
import type {
  InternalProject,
  InternalProjectQuery,
  ProjectApi,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryOttlTransformChannel } from "../channels/memory/memory.ottl-transform.channel.ts";
import { MemoryProviderAccountChannel } from "../channels/memory/memory.provider-account.channel.ts";
import { PullDestinationService } from "../features/ingestion-pull/services/pull-destination.service.ts";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../features/ingestion-source/services/ingestion-source-secret.service.ts";
import type {
  IngestionSourceEntitlements,
  IngestionSourceLifecycleChannel,
} from "../features/ingestion-source/services/ingestion-source.service.ts";
import { IngestionSourceService } from "../features/ingestion-source/services/ingestion-source.service.ts";
import { MemoryIngestionSourceRepository } from "../repositories/memory/memory.ingestion-source.repository.ts";
import type { GovernanceDiagnosticsSink } from "../services/governance-policy.service.ts";

const ORG = "org-1";
const WORKSPACE = "https://adb-1234567890123456.7.azuredatabricks.net";

class Enterprise implements IngestionSourceEntitlements {
  async hasEnterprisePlan(): Promise<boolean> {
    return true;
  }
}
class NoLifecycle implements IngestionSourceLifecycleChannel {
  async sync(): Promise<void> {}
}
class NoDiagnostics implements GovernanceDiagnosticsSink {
  warn(): void {}
}

function harness() {
  const repository = MemoryIngestionSourceRepository.create();
  const service = IngestionSourceService.create({
    repository,
    projects: createApiFixture<ProjectApi>(
      {
        ensureInternal: async (_input: InternalProjectQuery): Promise<InternalProject> => ({
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
    ),
    entitlements: new Enterprise(),
    lifecycle: new NoLifecycle(),
    secrets: IngestionSecretService.create(
      IngestionSecretConfiguration.create({ pepper: "pepper" }),
    ),
    destinations: PullDestinationService.create(),
    providerAccounts: MemoryProviderAccountChannel.create(),
    diagnostics: new NoDiagnostics(),
    ottl: MemoryOttlTransformChannel.create(),
  });

  const createGenie = (startingAt: string) =>
    service.createSource({
      organizationId: ORG,
      sourceType: "databricks_genie",
      name: "Genie",
      pullConfig: {
        adapter: "databricks_genie",
        workspaceUrl: WORKSPACE,
        spaceIds: [],
        startingAt,
        schedule: "*/15 * * * *",
        credentials: { token: "dapi-test-token" },
      },
      pullSchedule: "*/15 * * * *",
      actorUserId: "user-1",
    });

  return { repository, createGenie };
}

describe("given an admin creating a Databricks Genie source", () => {
  describe("when its backfill start is a bare date the adapter's schema refuses", () => {
    /** @scenario "A Databricks Genie configuration its adapter refuses is not stored" */
    it("refuses the save by the field's name and stores no source", async () => {
      const { repository, createGenie } = harness();

      await expect(createGenie("2026-08-01")).rejects.toMatchObject({
        code: "validation_error",
        meta: { formErrors: [expect.stringMatching(/^Read history from: /)] },
      });
      expect(await repository.findAll(ORG)).toEqual([]);
    });

    it("stores the same source once the start is an instant", async () => {
      const { repository, createGenie } = harness();

      await createGenie("2026-08-01T00:00:00.000Z");

      expect(await repository.findAll(ORG)).toHaveLength(1);
    });
  });
});
