/**
 * @vitest-environment node
 * `ProjectOperationsService`'s cross-entity half: saving the settings form
 * revokes outstanding trace shares when sharing is turned OFF. Characterized
 * here because it is the application's decision, not one door's.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  ProjectService,
  type Project,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import { describe, expect, it, vi } from "vitest";

import { ProjectOperationsService } from "../project-operations.service.ts";

type ProjectOperationsOverrides = {
  tryGetWithTeam?: ProjectService["tryGetWithTeam"];
  update?: ProjectService["update"];
};

/** A typed service double for the two orchestration seams under characterization. */
class CharacterizationProjectService extends ProjectService {
  constructor(private readonly overrides: ProjectOperationsOverrides) {
    super();
  }

  listPaths(): Promise<never> {
    return this.unimplemented("listPaths");
  }

  tryGetWithTeam: ProjectService["tryGetWithTeam"] = (id) =>
    this.overrides.tryGetWithTeam?.(id) ?? Promise.resolve(null);
  update: ProjectService["update"] = (input) =>
    this.overrides.update?.(input) ?? this.unimplemented("update");

  tryFindInternal: ProjectService["tryFindInternal"] = () => this.unimplemented("tryFindInternal");
  ensureInternal: ProjectService["ensureInternal"] = () => this.unimplemented("ensureInternal");
  isPresenceEnabled: ProjectService["isPresenceEnabled"] = () =>
    this.unimplemented("isPresenceEnabled");
  getById: ProjectService["getById"] = () => this.unimplemented("getById");
  tryGetIdentity: ProjectService["tryGetIdentity"] = () => this.unimplemented("tryGetIdentity");
  getOrganizationId: ProjectService["getOrganizationId"] = () =>
    this.unimplemented("getOrganizationId");
  tryGetOrganizationId: ProjectService["tryGetOrganizationId"] = () =>
    this.unimplemented("tryGetOrganizationId");
  tryGetById: ProjectService["tryGetById"] = () => this.unimplemented("tryGetById");
  tryGetSummaryById: ProjectService["tryGetSummaryById"] = () =>
    this.unimplemented("tryGetSummaryById");
  getWithTeam: ProjectService["getWithTeam"] = () => this.unimplemented("getWithTeam");
  create: ProjectService["create"] = () => this.unimplemented("create");
  archive: ProjectService["archive"] = () => this.unimplemented("archive");
  listByOrganization: ProjectService["listByOrganization"] = () =>
    this.unimplemented("listByOrganization");
  listByTeam: ProjectService["listByTeam"] = () => this.unimplemented("listByTeam");
  listNamesByIds: ProjectService["listNamesByIds"] = () => this.unimplemented("listNamesByIds");
  listIdsByOrganization: ProjectService["listIdsByOrganization"] = () =>
    this.unimplemented("listIdsByOrganization");
  listActiveByScopes: ProjectService["listActiveByScopes"] = () =>
    this.unimplemented("listActiveByScopes");
  updateMetadata: ProjectService["updateMetadata"] = () => this.unimplemented("updateMetadata");
  touchCodingAgentSessionSeen: ProjectService["touchCodingAgentSessionSeen"] = () =>
    this.unimplemented("touchCodingAgentSessionSeen");
  touchCodingAgentPullRequestSeen: ProjectService["touchCodingAgentPullRequestSeen"] = () =>
    this.unimplemented("touchCodingAgentPullRequestSeen");
  searchByQuery: ProjectService["searchByQuery"] = () => this.unimplemented("searchByQuery");
  tryGetTraceSharingConfig: ProjectService["tryGetTraceSharingConfig"] = () =>
    this.unimplemented("tryGetTraceSharingConfig");
  resolveOrgAdmin: ProjectService["resolveOrgAdmin"] = () => this.unimplemented("resolveOrgAdmin");
  resolveTraceDestination: ProjectService["resolveTraceDestination"] = () =>
    this.unimplemented("resolveTraceDestination");
  tryGetTraceDestination: ProjectService["tryGetTraceDestination"] = () =>
    this.unimplemented("tryGetTraceDestination");
  listTraceDestinations: ProjectService["listTraceDestinations"] = () =>
    this.unimplemented("listTraceDestinations");

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(
      new Error(`CharacterizationProjectService does not implement ${operation}`),
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

const refusingApiKeys = (): ApiKeyApi =>
  new Proxy({} as ApiKeyApi, {
    get:
      () =>
      (): Promise<never> =>
        Promise.reject(new Error("the api-key boundary is not configured for this test")),
  });

const refusingTopics = (): TopicApi =>
  new Proxy({} as TopicApi, {
    get:
      () =>
      (): Promise<never> =>
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
  projects: ProjectOperationsOverrides;
  revokeAllTraceShares: ShareApi["revokeAllTraceShares"];
}): ProjectOperationsService {
  return ProjectOperationsService.create({
    projects: new CharacterizationProjectService(options.projects),
    apiKeys: refusingApiKeys(),
    share: new CharacterizationShareApi(options.revokeAllTraceShares),
    topics: refusingTopics(),
    topicClustering: { requestClustering: async () => {} },
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
        projects: { tryGetWithTeam: async () => characterizationProject(true), update },
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
          tryGetWithTeam: async () => characterizationProject(false),
          update: async () => characterizationProject(false),
        },
        revokeAllTraceShares,
      });

      await operations.updateSettings({ projectId: "project_123", traceSharingEnabled: false });

      expect(revokeAllTraceShares).not.toHaveBeenCalled();
    });
  });
});
