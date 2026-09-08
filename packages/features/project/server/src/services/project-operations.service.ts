/**
 * The project operations a door would otherwise have to sequence itself.
 *
 * `ProjectApp` delegates here so that a REST handler, a tRPC procedure and a
 * background job all run the same steps:
 *
 *   - attributing a creation to the caller who asked for it;
 *   - resolving the project's organization before a settings write, and
 *     revoking outstanding trace shares when trace sharing is turned off;
 *   - archiving a project that is not the one the caller is in, including the
 *     "it was already gone" answer that makes the click idempotent;
 *   - declining a manual clustering request while a run is already in flight,
 *     which is a decision about domain state rather than about transport.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import {
  ProjectNotFoundError,
  type Project,
  type ProjectService,
  type TopicClusteringRequest,
  type UpdateProjectInput,
} from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";

/** Who a write is attributed to. */
type ProjectCaller = Readonly<{ id: string }>;

/**
 * The scheduler command a manual clustering request is sent as. Named
 * structurally rather than imported, because the command lives in the topic
 * feature's own server package and these operations only ever send one.
 */
type TopicClusteringCommands = Readonly<{
  requestClustering(
    input: Readonly<{
      tenantId: string;
      occurredAt: number;
      trigger: "manual";
      requestedByUserId: string;
    }>,
  ): Promise<void>;
}>;

export class ProjectOperationsService {
  private constructor(
    private readonly projects: ProjectService,
    private readonly apiKeys: ApiKeyService,
    private readonly share: ShareService,
    private readonly topics: TopicService,
    private readonly topicClustering: TopicClusteringCommands,
    private readonly now: () => number,
  ) {}

  static create({
    projects,
    apiKeys,
    share,
    topics,
    topicClustering,
    now,
  }: Readonly<{
    projects: ProjectService;
    apiKeys: ApiKeyService;
    share: ShareService;
    topics: TopicService;
    topicClustering: TopicClusteringCommands;
    /** Epoch milliseconds, so the one clock stamps every request. */
    now: () => number;
  }>): ProjectOperationsService {
    return new ProjectOperationsService(projects, apiKeys, share, topics, topicClustering, now);
  }

  /**
   * Provisions a project, attributed to the caller who asked for it.
   *
   * The attribution is here rather than in each door because "who created
   * this" is a property of the act, not of the transport it arrived over.
   */
  create(
    input: Readonly<{
      organizationId: string;
      teamId?: string | undefined;
      newTeamName?: string | undefined;
      name: string;
      language: string;
      framework: string;
    }>,
    by: ProjectCaller,
  ): Promise<Project> {
    return this.projects.create({
      organizationId: input.organizationId,
      userId: by.id,
      teamId: input.teamId,
      newTeamName: input.newTeamName,
      name: input.name,
      language: input.language,
      framework: input.framework,
    });
  }

  /**
   * Writes the project settings form.
   *
   * The organization is read from the project rather than taken from the
   * caller, because the update is authorized against the project and a
   * caller-supplied tenant would be a second, unchecked answer to the same
   * question. Turning trace sharing off revokes the links already handed out:
   * leaving them live would mean the setting says "off" while the traces stay
   * readable. Secret fields arrive as ciphertext: encryption is the process's,
   * not this feature's.
   */
  async updateSettings(input: Readonly<UpdateProjectInput & { projectId: string }>): Promise<Project> {
    const project = await this.projects.tryGetWithTeam(input.projectId);
    if (!project) throw new ProjectNotFoundError();

    const data: UpdateProjectInput = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.language !== undefined && { language: input.language }),
      ...(input.framework !== undefined && { framework: input.framework }),
      ...(input.userLinkTemplate !== undefined && {
        userLinkTemplate: input.userLinkTemplate,
      }),
      ...(input.teamId && { teamId: input.teamId }),
      traceSharingEnabled: input.traceSharingEnabled,
      presenceEnabled: input.presenceEnabled,
      s3Endpoint: input.s3Endpoint ?? null,
      s3AccessKeyId: input.s3AccessKeyId ?? null,
      s3SecretAccessKey: input.s3SecretAccessKey ?? null,
      s3Bucket: input.s3Bucket,
    };

    const updated = await this.projects.update({
      id: input.projectId,
      organizationId: project.team.organizationId,
      data,
    });

    if (input.traceSharingEnabled === false && project.traceSharingEnabled === true) {
      await this.share.revokeAllTraceShares(input.projectId);
    }

    return updated;
  }

  /**
   * Archives a project the caller named, which is never the one they are
   * currently in.
   *
   * A project that is already gone answers "already archived" rather than
   * failing: the caller asked for it to be gone, and it is. The organization
   * comes from the project itself for the same reason `updateSettings` reads
   * it there.
   */
  async archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }> {
    const target = await this.projects.tryGetWithTeam(input.projectId);
    if (!target) return { alreadyArchived: true };

    try {
      await this.projects.archive({
        id: input.projectId,
        organizationId: target.team.organizationId,
      });
      return { alreadyArchived: false };
    } catch (error) {
      if (error instanceof ProjectNotFoundError) return { alreadyArchived: true };
      throw error;
    }
  }

  /** Rotates the legacy project write credential. */
  regenerateLegacyProjectKey(input: Readonly<{ projectId: string }>): Promise<string> {
    return this.apiKeys.regenerateLegacyProjectKey(input);
  }

  /**
   * Asks the scheduler for a manual topic-clustering run, attributed to the
   * caller who asked for it.
   *
   * A request made while a run is already underway is declined by the
   * scheduler, not queued behind it, so an unconditional "started" would tell
   * the caller a run began when nothing did. The read model is the only place
   * that answer is visible before the scheduler makes it. Best effort by
   * nature: the scheduler, not this check, is what keeps two runs off one
   * project.
   */
  async requestTopicClustering(
    input: Readonly<{ projectId: string }>,
    by: ProjectCaller,
  ): Promise<TopicClusteringRequest> {
    if ((await this.topics.getClusteringStatus(input)).isRunInFlight) {
      return { started: false, reason: "already_running" };
    }
    await this.topicClustering.requestClustering({
      tenantId: input.projectId,
      occurredAt: this.now(),
      trigger: "manual",
      requestedByUserId: by.id,
    });
    return { started: true };
  }
}
