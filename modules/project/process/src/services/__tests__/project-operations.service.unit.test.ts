/**
 * @vitest-environment node
 * `ProjectOperationsService`'s cross-entity half: saving the settings form
 * revokes outstanding trace shares when sharing is turned OFF. Characterized
 * here because it is the application's decision, not one door's.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { Project, ProjectWithTeam } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import { describe, expect, it, vi } from "vitest";

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

function characterizationOperations(options: {
  projects: Partial<ProjectOperationsDirectory>;
  revokeAllTraceShares: ShareApi["revokeAllTraceShares"];
}): ProjectOperationsService {
  return ProjectOperationsService.create({
    projects: new CharacterizationProjectDirectory(options.projects),
    share: new CharacterizationShareApi(options.revokeAllTraceShares),
    topics: refusingTopics(),
    auditLog: createApiFixture<AuditLogApi>({
      record: async () => ({ id: "audit", occurredAt: 0 }),
    }),
    lifecycle: { legacyKeyRevoked: async () => undefined },
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

      await operations.updateSettings({ projectId: "project_123", traceSharingEnabled: false });

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

      await operations.updateSettings({ projectId: "project_123", traceSharingEnabled: false });

      expect(revokeAllTraceShares).not.toHaveBeenCalled();
    });
  });

  describe("when the settings form saves an endpoint with a blank secret", () => {
    const storage = {
      projectId: "project_123",
      s3Endpoint: "cipher(https://s3.example)",
      s3AccessKeyId: "cipher(AKIA)",
    };

    /** @scenario A first-time storage setup with a blank secret is refused */
    it("refuses it when no secret is stored yet", async () => {
      const update = vi.fn(async () => characterizationProject(false));
      const operations = characterizationOperations({
        projects: { findWithTeam: async () => characterizationProject(false), update },
        revokeAllTraceShares: async () => {},
      });

      await expect(operations.updateSettings(storage)).rejects.toMatchObject({
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

      await operations.updateSettings(storage);

      expect(update).toHaveBeenCalledOnce();
    });
  });
});
