import type { ProjectApi } from "@langwatch/project-contract";

/**
 * A complete `ProjectApi` fake, so a suite stays at the module boundary: what a
 * test cares about is supplied as an override or overridden by a subclass, and
 * everything else refuses by name.
 */
export class TestProjectApi implements ProjectApi {
  constructor(protected readonly overrides: Partial<ProjectApi> = {}) {}

  listPaths(input: Parameters<ProjectApi["listPaths"]>[0]): ReturnType<ProjectApi["listPaths"]> {
    return this.overrides.listPaths?.(input) ?? this.unimplemented("listPaths");
  }

  tryGetOrganizationId(
    projectId: Parameters<ProjectApi["tryGetOrganizationId"]>[0],
  ): ReturnType<ProjectApi["tryGetOrganizationId"]> {
    return (
      this.overrides.tryGetOrganizationId?.(projectId) ?? this.unimplemented("tryGetOrganizationId")
    );
  }

  isPresenceEnabled(
    input: Parameters<ProjectApi["isPresenceEnabled"]>[0],
  ): ReturnType<ProjectApi["isPresenceEnabled"]> {
    return this.overrides.isPresenceEnabled?.(input) ?? this.unimplemented("isPresenceEnabled");
  }

  tryGetSummaryById(
    projectId: Parameters<ProjectApi["tryGetSummaryById"]>[0],
  ): ReturnType<ProjectApi["tryGetSummaryById"]> {
    return this.overrides.tryGetSummaryById?.(projectId) ?? this.unimplemented("tryGetSummaryById");
  }

  searchByQuery(
    input: Parameters<ProjectApi["searchByQuery"]>[0],
  ): ReturnType<ProjectApi["searchByQuery"]> {
    return this.overrides.searchByQuery?.(input) ?? this.unimplemented("searchByQuery");
  }

  tryGetById(id: Parameters<ProjectApi["tryGetById"]>[0]): ReturnType<ProjectApi["tryGetById"]> {
    return this.overrides.tryGetById?.(id) ?? this.unimplemented("tryGetById");
  }

  getOrganizationId(
    projectId: Parameters<ProjectApi["getOrganizationId"]>[0],
  ): ReturnType<ProjectApi["getOrganizationId"]> {
    return this.overrides.getOrganizationId?.(projectId) ?? this.unimplemented("getOrganizationId");
  }

  getWithTeam(id: Parameters<ProjectApi["getWithTeam"]>[0]): ReturnType<ProjectApi["getWithTeam"]> {
    return this.overrides.getWithTeam?.(id) ?? this.unimplemented("getWithTeam");
  }

  tryGetWithTeam(
    id: Parameters<ProjectApi["tryGetWithTeam"]>[0],
  ): ReturnType<ProjectApi["tryGetWithTeam"]> {
    return this.overrides.tryGetWithTeam?.(id) ?? this.unimplemented("tryGetWithTeam");
  }

  listByOrganization(
    input: Parameters<ProjectApi["listByOrganization"]>[0],
  ): ReturnType<ProjectApi["listByOrganization"]> {
    return this.overrides.listByOrganization?.(input) ?? this.unimplemented("listByOrganization");
  }

  listByTeam(input: Parameters<ProjectApi["listByTeam"]>[0]): ReturnType<ProjectApi["listByTeam"]> {
    return this.overrides.listByTeam?.(input) ?? this.unimplemented("listByTeam");
  }

  listNamesByIds(
    input: Parameters<ProjectApi["listNamesByIds"]>[0],
  ): ReturnType<ProjectApi["listNamesByIds"]> {
    return this.overrides.listNamesByIds?.(input) ?? this.unimplemented("listNamesByIds");
  }

  listIdsByOrganization(
    input: Parameters<ProjectApi["listIdsByOrganization"]>[0],
  ): ReturnType<ProjectApi["listIdsByOrganization"]> {
    return (
      this.overrides.listIdsByOrganization?.(input) ?? this.unimplemented("listIdsByOrganization")
    );
  }

  create(
    input: Parameters<ProjectApi["create"]>[0],
    by: Parameters<ProjectApi["create"]>[1],
  ): ReturnType<ProjectApi["create"]> {
    return this.overrides.create?.(input, by) ?? this.unimplemented("create");
  }

  updateSettings(
    input: Parameters<ProjectApi["updateSettings"]>[0],
  ): ReturnType<ProjectApi["updateSettings"]> {
    return this.overrides.updateSettings?.(input) ?? this.unimplemented("updateSettings");
  }

  archive(input: Parameters<ProjectApi["archive"]>[0]): ReturnType<ProjectApi["archive"]> {
    return this.overrides.archive?.(input) ?? this.unimplemented("archive");
  }

  regenerateLegacyProjectKey(
    input: Parameters<ProjectApi["regenerateLegacyProjectKey"]>[0],
  ): ReturnType<ProjectApi["regenerateLegacyProjectKey"]> {
    return (
      this.overrides.regenerateLegacyProjectKey?.(input) ??
      this.unimplemented("regenerateLegacyProjectKey")
    );
  }

  findIdByLegacyApiKey(
    input: Parameters<ProjectApi["findIdByLegacyApiKey"]>[0],
  ): ReturnType<ProjectApi["findIdByLegacyApiKey"]> {
    return (
      this.overrides.findIdByLegacyApiKey?.(input) ?? this.unimplemented("findIdByLegacyApiKey")
    );
  }

  rotateLegacyApiKey(
    input: Parameters<ProjectApi["rotateLegacyApiKey"]>[0],
  ): ReturnType<ProjectApi["rotateLegacyApiKey"]> {
    return this.overrides.rotateLegacyApiKey?.(input) ?? this.unimplemented("rotateLegacyApiKey");
  }

  findTraceSharingConfig(
    input: Parameters<ProjectApi["findTraceSharingConfig"]>[0],
  ): ReturnType<ProjectApi["findTraceSharingConfig"]> {
    return (
      this.overrides.findTraceSharingConfig?.(input) ?? this.unimplemented("findTraceSharingConfig")
    );
  }

  findPersonalWorkspaceOwner(
    input: Parameters<ProjectApi["findPersonalWorkspaceOwner"]>[0],
  ): ReturnType<ProjectApi["findPersonalWorkspaceOwner"]> {
    return (
      this.overrides.findPersonalWorkspaceOwner?.(input) ??
      this.unimplemented("findPersonalWorkspaceOwner")
    );
  }

  requestTopicClustering(
    input: Parameters<ProjectApi["requestTopicClustering"]>[0],
    by: Parameters<ProjectApi["requestTopicClustering"]>[1],
  ): ReturnType<ProjectApi["requestTopicClustering"]> {
    return (
      this.overrides.requestTopicClustering?.(input, by) ??
      this.unimplemented("requestTopicClustering")
    );
  }

  touchCodingAgentPullRequestSeen(
    input: Parameters<ProjectApi["touchCodingAgentPullRequestSeen"]>[0],
  ): ReturnType<ProjectApi["touchCodingAgentPullRequestSeen"]> {
    return (
      this.overrides.touchCodingAgentPullRequestSeen?.(input) ??
      this.unimplemented("touchCodingAgentPullRequestSeen")
    );
  }

  touchCodingAgentSessionSeen(
    input: Parameters<ProjectApi["touchCodingAgentSessionSeen"]>[0],
  ): ReturnType<ProjectApi["touchCodingAgentSessionSeen"]> {
    return (
      this.overrides.touchCodingAgentSessionSeen?.(input) ??
      this.unimplemented("touchCodingAgentSessionSeen")
    );
  }

  findInternal(
    input: Parameters<ProjectApi["findInternal"]>[0],
  ): ReturnType<ProjectApi["findInternal"]> {
    return this.overrides.findInternal?.(input) ?? this.unimplemented("findInternal");
  }

  ensureInternal(
    input: Parameters<ProjectApi["ensureInternal"]>[0],
  ): ReturnType<ProjectApi["ensureInternal"]> {
    return this.overrides.ensureInternal?.(input) ?? this.unimplemented("ensureInternal");
  }

  findIdentity(
    id: Parameters<ProjectApi["findIdentity"]>[0],
  ): ReturnType<ProjectApi["findIdentity"]> {
    return this.overrides.findIdentity?.(id) ?? this.unimplemented("findIdentity");
  }

  listActiveByScopes(
    input: Parameters<ProjectApi["listActiveByScopes"]>[0],
  ): ReturnType<ProjectApi["listActiveByScopes"]> {
    return this.overrides.listActiveByScopes?.(input) ?? this.unimplemented("listActiveByScopes");
  }

  updateMetadata(
    input: Parameters<ProjectApi["updateMetadata"]>[0],
  ): ReturnType<ProjectApi["updateMetadata"]> {
    return this.overrides.updateMetadata?.(input) ?? this.unimplemented("updateMetadata");
  }

  resolveOrgAdmin(
    projectId: Parameters<ProjectApi["resolveOrgAdmin"]>[0],
  ): ReturnType<ProjectApi["resolveOrgAdmin"]> {
    return this.overrides.resolveOrgAdmin?.(projectId) ?? this.unimplemented("resolveOrgAdmin");
  }

  resolveTraceDestination(
    input: Parameters<ProjectApi["resolveTraceDestination"]>[0],
  ): ReturnType<ProjectApi["resolveTraceDestination"]> {
    return (
      this.overrides.resolveTraceDestination?.(input) ??
      this.unimplemented("resolveTraceDestination")
    );
  }

  findTraceDestination(
    projectId: Parameters<ProjectApi["findTraceDestination"]>[0],
  ): ReturnType<ProjectApi["findTraceDestination"]> {
    return (
      this.overrides.findTraceDestination?.(projectId) ?? this.unimplemented("findTraceDestination")
    );
  }

  listTraceDestinations(
    projectIds: Parameters<ProjectApi["listTraceDestinations"]>[0],
  ): ReturnType<ProjectApi["listTraceDestinations"]> {
    return (
      this.overrides.listTraceDestinations?.(projectIds) ??
      this.unimplemented("listTraceDestinations")
    );
  }

  protected unimplemented(operation: string): Promise<never> {
    return Promise.reject(new Error(`TestProjectApi does not implement ${operation}`));
  }
}
