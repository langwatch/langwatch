/**
 * The project feature's application: what its doors call.
 *
 * It holds every service the feature's api files reach, and it is the one
 * typed thing a transport is given. Before it, `project.api.ts` declared its
 * own private `Readonly<{ projects; apiKeys; share; topics; topicClustering }>`
 * — a description of the process's composition that agreed with the process by
 * attention rather than by construction.
 *
 * Most operations are the services' own, reached through the dependencies
 * below. What lives here as a method is what a door would otherwise have to
 * know:
 *
 *   - attributing a creation to its caller, which `create` stamped for itself;
 *   - resolving the project's organization before a settings write, and
 *     revoking outstanding trace shares when trace sharing is turned off —
 *     three steps a handler was sequencing;
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
  type UpdateProjectInput,
} from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";

/** Who a write is attributed to. */
export interface ProjectCaller {
  readonly id: string;
}

/**
 * The scheduler command a manual clustering request is sent as. Named
 * structurally rather than imported, because the command lives in the topic
 * feature's own server package and this application only ever sends one.
 */
export type TopicClusteringCommands = Readonly<{
  requestClustering(
    input: Readonly<{
      tenantId: string;
      occurredAt: number;
      trigger: "manual";
      requestedByUserId: string;
    }>,
  ): Promise<void>;
}>;

/** What the process composes this feature's application from. */
export interface ProjectAppDependencies {
  projects: ProjectService;
  apiKeys: ApiKeyService;
  share: ShareService;
  topics: TopicService;
  topicClustering: TopicClusteringCommands;
}

/** The settings a door may write, already encrypted where the field is a secret. */
export type UpdateProjectSettings = Readonly<{
  projectId: string;
  name?: string | undefined;
  language?: string | undefined;
  framework?: string | undefined;
  teamId?: string | undefined;
  traceSharingEnabled?: boolean | undefined;
  presenceEnabled?: boolean | undefined;
  userLinkTemplate?: string | undefined;
  /** Already ciphertext: encryption is the process's, not this feature's. */
  s3Endpoint?: string | null | undefined;
  s3AccessKeyId?: string | null | undefined;
  s3SecretAccessKey?: string | null | undefined;
  s3Bucket?: string | undefined;
}>;

/** What a manual clustering request did, which is not always "started a run". */
export type TopicClusteringRequest =
  | Readonly<{ started: true }>
  | Readonly<{ started: false; reason: "already_running" }>;

export class ProjectApp {
  static create(dependencies: ProjectAppDependencies): ProjectApp {
    return new ProjectApp(dependencies);
  }

  private constructor(private readonly dependencies: ProjectAppDependencies) {}

  /** One project, or absent when nothing by that id exists. */
  tryGetById(id: string): Promise<Project | null> {
    return this.dependencies.projects.tryGetById(id);
  }

  /**
   * The service itself, for the process functions that still take it whole.
   *
   * None of them is a project door: the LangWatchQL rollout gate resolves the
   * project's organization before reading a flag, the gateway's trace-destination
   * read lists the projects a page of virtual keys points at, and the personal
   * usage roll-up resolves the organization's hidden governance project. Each
   * takes a `ProjectService` as a parameter, so a narrowed shape will not do.
   * Until they move, this getter is the seam that remains — the same one
   * `ModelProviderApp.providerService` keeps.
   */
  get projectService(): ProjectService {
    return this.dependencies.projects;
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
    return this.dependencies.projects.create({
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
   * readable.
   */
  async updateSettings(input: UpdateProjectSettings): Promise<Project> {
    const project = await this.dependencies.projects.tryGetWithTeam(input.projectId);
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

    const updated = await this.dependencies.projects.update({
      id: input.projectId,
      organizationId: project.team.organizationId,
      data,
    });

    if (input.traceSharingEnabled === false && project.traceSharingEnabled === true) {
      await this.dependencies.share.revokeAllTraceShares(input.projectId);
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
    const target = await this.dependencies.projects.tryGetWithTeam(input.projectId);
    if (!target) return { alreadyArchived: true };

    try {
      await this.dependencies.projects.archive({
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
    return this.dependencies.apiKeys.regenerateLegacyProjectKey(input);
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
    if ((await this.dependencies.topics.getClusteringStatus(input)).isRunInFlight) {
      return { started: false, reason: "already_running" };
    }
    await this.dependencies.topicClustering.requestClustering({
      tenantId: input.projectId,
      occurredAt: Date.now(),
      trigger: "manual",
      requestedByUserId: by.id,
    });
    return { started: true };
  }
}
