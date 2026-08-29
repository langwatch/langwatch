import { ProjectService } from "@langwatch/project-contract";

/** Complete contract fake for tests that do not cross the Project boundary. */
export class TestProjectService extends ProjectService {
  private unsupported(): Promise<never> {
    return Promise.reject(new Error("ProjectService is not used by this test"));
  }

  tryFindInternal() {
    return this.unsupported();
  }
  ensureInternal() {
    return this.unsupported();
  }
  isPresenceEnabled() {
    return this.unsupported();
  }
  getById() {
    return this.unsupported();
  }
  getOrganizationId() {
    return this.unsupported();
  }
  tryGetOrganizationId() {
    return this.unsupported();
  }
  tryGetIdentity() {
    return this.unsupported();
  }
  tryGetById() {
    return this.unsupported();
  }
  tryGetSummaryById() {
    return this.unsupported();
  }
  getWithTeam() {
    return this.unsupported();
  }
  tryGetWithTeam() {
    return this.unsupported();
  }
  create() {
    return this.unsupported();
  }
  update() {
    return this.unsupported();
  }
  archive() {
    return this.unsupported();
  }
  listByOrganization() {
    return this.unsupported();
  }
  listByTeam() {
    return this.unsupported();
  }
  listNamesByIds() {
    return this.unsupported();
  }
  listIdsByOrganization() {
    return Promise.resolve([]);
  }
  listActiveByScopes() {
    return this.unsupported();
  }
  updateMetadata() {
    return this.unsupported();
  }
  touchCodingAgentSessionSeen() {
    return this.unsupported();
  }
  touchCodingAgentPullRequestSeen() {
    return this.unsupported();
  }
  searchByQuery() {
    return this.unsupported();
  }
  isFeatureEnabled() {
    return this.unsupported();
  }
  tryGetTraceSharingConfig() {
    return this.unsupported();
  }
  resolveOrgAdmin() {
    return this.unsupported();
  }
  resolveTraceDestination() {
    return this.unsupported();
  }
  tryGetTraceDestination() {
    return this.unsupported();
  }
  listTraceDestinations() {
    return this.unsupported();
  }
}
