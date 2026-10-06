import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { Project, ProjectWithTeam } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
/**
 * @vitest-environment node
 * `ProjectOperationsService`'s cross-entity half: saving the settings form
 * revokes outstanding trace shares when sharing is turned OFF. Characterized
 * here because it is the application's decision, not one door's.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TopicApi } from "@langwatch/topic-contract";
import { describe, expect, it, vi } from "vitest";

import type { ProjectStorageSettingsRepository } from "../../repositories/project-storage-settings.repository.ts";
import type { ProjectCreatedNoticeService } from "../project-created-notice.service.ts";
import {
  ProjectOperationsService,
  type ProjectOperationsDirectory,
} from "../project-operations.service.ts";

/** A typed double for the two orchestration seams under characterization. */
class CharacterizationProjectDirectory implements ProjectOperationsDirectory {
  constructor(private readonly overrides: Partial<ProjectOperationsDirectory>) {}

  findWithTeam: ProjectOperationsDirectory["findWithTeam"] = (id) =>
    this.overrides.findWithTeam?.(id) ?? Promise.resolve(null);

  update: ProjectOperationsDirectory["update"] = (input) =>
    this.overrides.update?.(input) ?? this.unimplemented("update");

  create: ProjectOperationsDirectory["create"] = (input) =>
    this.overrides.create?.(input) ?? this.unimplemented("create");

  archive: ProjectOperationsDirectory["archive"] = (input) =>
    this.overrides.archive?.(input) ?? this.unimplemented("archive");

  getById: ProjectOperationsDirectory["getById"] = (id) =>
    this.overrides.getById?.(id) ?? this.unimplemented("getById");

  rotateLegacyApiKey: ProjectOperationsDirectory["rotateLegacyApiKey"] = (input) =>
    this.overrides.rotateLegacyApiKey?.(input) ?? this.unimplemented("rotateLegacyApiKey");

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(
      new Error(`CharacterizationProjectDirectory does not implement ${operation}`),
    );
  }
}

class CharacterizationShareApi implements ShareApi {
  readonly revokeAllTraceShares: ShareApi["revokeAllTraceShares"];

  constructor(revoke: ShareApi["revokeAllTraceShares"]) {
    this.revokeAllTraceShares = revoke;
  }

  listForResource: ShareApi["listForResource"] = () => this.unimplemented();
  resolveForViewer: ShareApi["resolveForViewer"] = () => this.unimplemented();
  createShare: ShareApi["createShare"] = () => this.unimplemented();
  revokeById: ShareApi["revokeById"] = () => this.unimplemented();
  unshare: ShareApi["unshare"] = () => this.unimplemented();
  pinTrace: ShareApi["pinTrace"] = () => this.unimplemented();
  unpinTrace: ShareApi["unpinTrace"] = () => this.unimplemented();
  findTracePin: ShareApi["findTracePin"] = () => this.unimplemented();
  listTracePins: ShareApi["listTracePins"] = () => this.unimplemented();
  findCachedPayload: ShareApi["findCachedPayload"] = () => this.unimplemented();
  cachePayload: ShareApi["cachePayload"] = () => this.unimplemented();

  private unimplemented(): Promise<never> {
    return Promise.reject(new Error("CharacterizationShareApi operation is not configured"));
  }
}

const refusingTopics = (): TopicApi =>
  new Proxy({} as TopicApi, {
    get: () => (): Promise<never> =>
      Promise.reject(new Error("the topic boundary is not configured for this test")),
  });

function characterizationProject(traceSharingEnabled: boolean): ProjectWithTeam {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  const project: Project = {
    id: "project_123",
    name: "Project",
    slug: "project",
    apiKey: "sk-lw-test",
    lwqlKey: "lwql-test",
    teamId: "team-1",
    language: "typescript",
    framework: "test",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    userLinkTemplate: null,
    traceSharingEnabled,
    presenceEnabled: true,
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

  return {
    ...project,
    team: {
      id: "team-1",
      name: "Team",
      slug: "team",
      organizationId: "org-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      departmentId: null,
    },
  };
}

const MEMBER = { id: "user_1" };

type PresenceSettingChange = Parameters<ProjectCreatedNoticeService["presenceSettingChanged"]>[0];

function characterizationOperations(options: {
  projects: Partial<ProjectOperationsDirectory>;
  storageSettings?: ProjectStorageSettingsRepository["update"];
  revokeAllTraceShares: ShareApi["revokeAllTraceShares"];
  presenceChanges?: PresenceSettingChange[];
}): ProjectOperationsService {
  return ProjectOperationsService.create({
    projects: new CharacterizationProjectDirectory(options.projects),
    storageSettings: {
      update: options.storageSettings ?? (async ({ settings }) => settings),
    },
    share: new CharacterizationShareApi(options.revokeAllTraceShares),
    topics: refusingTopics(),
    auditLog: createApiFixture<AuditLogApi>({
      record: async () => ({ id: "audit", occurredAt: 0 }),
    }),
    lifecycle: {
      legacyKeyRevoked: async () => undefined,
      presenceSettingChanged: async (change) => {
        options.presenceChanges?.push(change);
      },
    },
    logger: { error: () => undefined },
    now: () => 0,
  });
}

describe("ProjectOperationsService", () => {
  describe("when the settings form turns trace sharing off", () => {
    it("revokes outstanding trace shares", async () => {
      const revokeAllTraceShares = vi.fn(async () => {});
      const updated = characterizationProject(false);
      const update = vi.fn(async () => updated);
      const operations = characterizationOperations({
        projects: { findWithTeam: async () => characterizationProject(true), update },
        revokeAllTraceShares,
      });

      await operations.updateSettings(
        { projectId: "project_123", traceSharingEnabled: false },
        MEMBER,
      );

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ id: "project_123", organizationId: "org-1" }),
      );
      expect(revokeAllTraceShares).toHaveBeenCalledWith("project_123");
    });
  });

  describe("given trace sharing was already off", () => {
    it("leaves the shares alone", async () => {
      const revokeAllTraceShares = vi.fn(async () => {});
      const operations = characterizationOperations({
        projects: {
          findWithTeam: async () => characterizationProject(false),
          update: async () => characterizationProject(false),
        },
        revokeAllTraceShares,
      });

      await operations.updateSettings(
        { projectId: "project_123", traceSharingEnabled: false },
        MEMBER,
      );

      expect(revokeAllTraceShares).not.toHaveBeenCalled();
    });
  });

  describe("when the settings form saves an endpoint with a blank secret", () => {
    const storage = {
      projectId: "project_123",
      s3Endpoint: "https://s3.example",
      s3AccessKeyId: "AKIA",
    };

    /** @scenario A first-time storage setup with a blank secret is refused */
    it("refuses it when no secret is stored yet", async () => {
      const update = vi.fn(async () => characterizationProject(false));
      const operations = characterizationOperations({
        projects: { findWithTeam: async () => characterizationProject(false), update },
        revokeAllTraceShares: async () => {},
      });

      await expect(operations.updateSettings(storage, MEMBER)).rejects.toMatchObject({
        code: "validation_error",
        httpStatus: 400,
      });
      expect(update).not.toHaveBeenCalled();
    });

    /** @scenario A blank storage secret leaves the stored secret unchanged */
    it("keeps the stored secret when one is held", async () => {
      const stored = { ...characterizationProject(false), s3SecretAccessKey: "cipher(shh)" };
      const update = vi.fn(async () => stored);
      const operations = characterizationOperations({
        projects: { findWithTeam: async () => stored, update },
        revokeAllTraceShares: async () => {},
      });

      await operations.updateSettings(storage, MEMBER);

      expect(update).toHaveBeenCalledOnce();
    });
  });

  describe("when the settings form saves stored-object credentials", () => {
    it("writes them through the storage repository and answers what it stored", async () => {
      const update = vi.fn(async (_input: unknown) => characterizationProject(false));
      const storageSettings = vi.fn<ProjectStorageSettingsRepository["update"]>(
        async ({ settings }) => ({ ...settings, s3Endpoint: "stored(endpoint)" }),
      );
      const operations = characterizationOperations({
        projects: { findWithTeam: async () => characterizationProject(false), update },
        storageSettings,
        revokeAllTraceShares: async () => {},
      });

      const answer = await operations.updateSettings(
        {
          projectId: "project_123",
          s3Endpoint: "https://s3.example",
          s3AccessKeyId: "AKIA",
          s3SecretAccessKey: "shh",
          s3Bucket: "bucket",
        },
        MEMBER,
      );

      expect(storageSettings).toHaveBeenCalledWith({
        projectId: "project_123",
        organizationId: "org-1",
        settings: {
          s3Endpoint: "https://s3.example",
          s3AccessKeyId: "AKIA",
          s3SecretAccessKey: "shh",
          s3Bucket: "bucket",
        },
      });
      expect(update.mock.calls[0]?.[0]).not.toHaveProperty("data.s3Endpoint");
      expect(answer.s3Endpoint).toBe("stored(endpoint)");
    });

    it("leaves the stored secret out of the write when none was sent", async () => {
      const storageSettings = vi.fn<ProjectStorageSettingsRepository["update"]>(
        async ({ settings }) => settings,
      );
      const held = { ...characterizationProject(false), s3SecretAccessKey: "held" };
      const operations = characterizationOperations({
        projects: { findWithTeam: async () => held, update: async () => held },
        storageSettings,
        revokeAllTraceShares: async () => {},
      });

      await operations.updateSettings(
        { projectId: "project_123", s3Endpoint: "https://s3.example", s3AccessKeyId: "AKIA" },
        MEMBER,
      );

      expect(storageSettings.mock.calls[0]?.[0].settings).not.toHaveProperty("s3SecretAccessKey");
    });
  });

  describe("given a project whose presence setting is on", () => {
    function presenceOperations() {
      const presenceChanges: PresenceSettingChange[] = [];
      const operations = characterizationOperations({
        projects: {
          findWithTeam: async () => characterizationProject(false),
          update: async () => characterizationProject(false),
        },
        revokeAllTraceShares: async () => {},
        presenceChanges,
      });
      return { operations, presenceChanges };
    }

    describe("when a member saves the settings with presence off", () => {
      /** @scenario "A changed project presence setting is recorded as project's fact" */
      it("records the change with the organization and the member who made it", async () => {
        const { operations, presenceChanges } = presenceOperations();

        await operations.updateSettings(
          { projectId: "project_123", presenceEnabled: false },
          MEMBER,
        );

        expect(presenceChanges).toEqual([
          {
            projectId: "project_123",
            organizationId: "org-1",
            presenceEnabled: false,
            changedByUserId: "user_1",
          },
        ]);
      });
    });

    describe("when a member saves the settings with presence unchanged or absent", () => {
      /** @scenario "Saving project settings without changing presence records no presence fact" */
      it("records no presence fact", async () => {
        const { operations, presenceChanges } = presenceOperations();

        await operations.updateSettings(
          { projectId: "project_123", presenceEnabled: true },
          MEMBER,
        );
        await operations.updateSettings({ projectId: "project_123", name: "Renamed" }, MEMBER);

        expect(presenceChanges).toEqual([]);
      });
    });
  });
});
