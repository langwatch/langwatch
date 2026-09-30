/**
 * @vitest-environment node
 * Analytics writes a new project's key-map row from project's created event (ARCHITECTURE §9).
 * Spec: specs/lwql/project-key-map.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_CREATED_EVENT_VERSION,
  PROJECT_LIFECYCLE_PIPELINE_NAME,
  type Project,
  type ProjectApi,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { LwqlKeyMapRepository } from "../../repositories/langwatch-ql-key-map.repository.ts";
import { LangWatchQLCapabilityService } from "../../services/langwatch-ql-capability.service.ts";
import { LwqlKeyMapService } from "../../services/langwatch-ql-key-map.service.ts";
import type { LwqlKeyMapRow } from "../../services/langwatch-ql-production-provisioning.service.ts";
import { buildLwqlReconvergence } from "../analytics-lwql-reconvergence.pipeline.ts";

const PROJECT_ID = "project-new";
const CONNECTION = {
  url: "http://clickhouse.test:8123",
  username: "lwql_reader",
  password: "reader-password",
  database: "lwql",
  tenantSetting: "SQL_lwql_tenant",
};

function project(id: string): Project {
  return {
    id,
    name: id,
    slug: id,
    apiKey: `legacy-${id}`,
    lwqlKey: `lwql-${id}`,
    teamId: `team-${id}`,
    language: "en",
    framework: "other",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

class RecordingKeyMapRepository extends LwqlKeyMapRepository {
  readonly rows: LwqlKeyMapRow[] = [];
  failWith: Error | undefined;

  async insertRow({ row }: { table: string; row: LwqlKeyMapRow }): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.rows.push(row);
  }
}

function keyMapOver(options: { configured?: boolean } = {}) {
  const repository = new RecordingKeyMapRepository();
  const findById = vi.fn(async (id: string) => (id === PROJECT_ID ? project(id) : null));
  const service = LwqlKeyMapService.create({
    repository,
    projects: createApiFixture<ProjectApi>({ findById }),
    ...(options.configured === false
      ? {}
      : { target: { connection: CONNECTION, sourceDatabase: "langwatch" } }),
  });
  return { repository, findById, service };
}

/** Project's pipeline as the contract names it: this module reads only its event type and data. */
function projectLifecycleStandIn() {
  return definePipeline({
    name: PROJECT_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: PROJECT_AGGREGATE_TYPE }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(PROJECT_CREATED_EVENT_TYPE),
        version: z.literal(PROJECT_CREATED_EVENT_VERSION),
        data: projectCreatedEventDataSchema,
      }),
    ])
    .build();
}

const expectedKeyHash = LangWatchQLCapabilityService.create().tenantCapability({
  secret: `lwql-${PROJECT_ID}`,
});

describe("analytics' key-map reaction to a created project", () => {
  describe("given a project was recorded as created", () => {
    /** @scenario "Analytics writes the key-map row when a project is created" */
    it("maps the project's key hash to the project, once however often it is handled", async () => {
      const { repository, service } = keyMapOver();
      const eventing = new EventSourcing({
        eventStore: EventStoreMemory.createForTesting(),
        processManagerMode: "producer-only",
      });
      eventing.register(
        buildLwqlReconvergence({
          app: {
            probeLwqlAccessModelOwner: async () => "none",
            convergeLwqlAccessModel: async () => void 0,
            syncLwqlKeyMapRow: (input) => service.syncProject(input),
          },
          bootedAt: 0,
        }),
      );
      const lifecycle = eventing.register(projectLifecycleStandIn());

      await lifecycle.service.storeEvents(
        [
          {
            id: "event-created",
            aggregateId: PROJECT_ID,
            aggregateType: PROJECT_AGGREGATE_TYPE,
            tenantId: createTenantId(PROJECT_ID),
            type: PROJECT_CREATED_EVENT_TYPE,
            version: PROJECT_CREATED_EVENT_VERSION,
            createdAt: 1,
            occurredAt: 1,
            data: {
              tenantId: PROJECT_ID,
              projectId: PROJECT_ID,
              organizationId: "organization-1",
              occurredAt: 1,
            },
          },
        ],
        { tenantId: createTenantId(PROJECT_ID) },
      );
      await vi.waitFor(() => expect(repository.rows).toHaveLength(1));
      await service.syncProject({ projectId: PROJECT_ID });

      const mappings = new Set(repository.rows.map((row) => `${row.KeyHash}->${row.TenantId}`));
      expect([...mappings]).toEqual([`${expectedKeyHash}->${PROJECT_ID}`]);
      await eventing.close();
    });
  });

  describe("when the insert fails", () => {
    it("throws, so the queue retries the delivery", async () => {
      const { repository, service } = keyMapOver();
      repository.failWith = new Error("ClickHouse unavailable");

      await expect(service.syncProject({ projectId: PROJECT_ID })).rejects.toThrow(
        "ClickHouse unavailable",
      );
    });
  });

  describe("when the project no longer exists", () => {
    it("writes nothing", async () => {
      const { repository, service } = keyMapOver();

      await service.syncProject({ projectId: "project-deleted" });

      expect(repository.rows).toEqual([]);
    });
  });

  describe("when this deployment offers no LangWatchQL", () => {
    it("neither reads the project nor writes a row", async () => {
      const { repository, findById, service } = keyMapOver({ configured: false });

      await service.syncProject({ projectId: PROJECT_ID });

      expect(findById).not.toHaveBeenCalled();
      expect(repository.rows).toEqual([]);
    });
  });
});
