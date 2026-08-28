import { ProjectService } from "@langwatch/project-contract";

const unsupported = <Method>(): Method =>
  (() => Promise.reject(new Error("not used by this test"))) as Method;

/** Complete project boundary for tests that only exercise one project method. */
export class TestProjectService extends ProjectService {
  tryFindInternal = unsupported<ProjectService["tryFindInternal"]>();
  ensureInternal = unsupported<ProjectService["ensureInternal"]>();
  isPresenceEnabled = unsupported<ProjectService["isPresenceEnabled"]>();
  getById = unsupported<ProjectService["getById"]>();
  getOrganizationId = unsupported<ProjectService["getOrganizationId"]>();
  tryGetIdentity = unsupported<ProjectService["tryGetIdentity"]>();
  tryGetById = unsupported<ProjectService["tryGetById"]>();
  tryGetSummaryById = unsupported<ProjectService["tryGetSummaryById"]>();
  getWithTeam = unsupported<ProjectService["getWithTeam"]>();
  tryGetWithTeam = unsupported<ProjectService["tryGetWithTeam"]>();
  create = unsupported<ProjectService["create"]>();
  update = unsupported<ProjectService["update"]>();
  archive = unsupported<ProjectService["archive"]>();
  listByOrganization = unsupported<ProjectService["listByOrganization"]>();
  listByTeam = unsupported<ProjectService["listByTeam"]>();
  listNamesByIds = unsupported<ProjectService["listNamesByIds"]>();
  listIdsByOrganization = unsupported<ProjectService["listIdsByOrganization"]>();
  listActiveByScopes = unsupported<ProjectService["listActiveByScopes"]>();
  updateMetadata = unsupported<ProjectService["updateMetadata"]>();
  touchCodingAgentSessionSeen =
    unsupported<ProjectService["touchCodingAgentSessionSeen"]>();
  touchCodingAgentPullRequestSeen =
    unsupported<ProjectService["touchCodingAgentPullRequestSeen"]>();
  searchByQuery = unsupported<ProjectService["searchByQuery"]>();
  tryGetTraceSharingConfig = unsupported<ProjectService["tryGetTraceSharingConfig"]>();
  resolveOrgAdmin = unsupported<ProjectService["resolveOrgAdmin"]>();
  resolveTraceDestination = unsupported<ProjectService["resolveTraceDestination"]>();
  tryGetTraceDestination = unsupported<ProjectService["tryGetTraceDestination"]>();
  listTraceDestinations = unsupported<ProjectService["listTraceDestinations"]>();
}
