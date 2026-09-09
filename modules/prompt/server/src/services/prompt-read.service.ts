/** Everything a caller reads about a prompt: the listing, one prompt, and its version history. */
import { createLogger } from "@langwatch/observability";
import {
  NotFoundError,
  parseLlmConfigVersion,
  parseRuntimeParameters,
} from "@langwatch/prompt-contract";
import { TagValidationError } from "../repositories/prompt-tag-assignment.repository.ts";
import type {
  LlmConfigRepository,
  LlmConfigWithLatestVersion,
} from "../repositories/prompt.repository.ts";
import { withLatestTag } from "../rules/prompt-shape.rules.ts";
import type { PromptTagLookupService } from "./prompt-tag-lookup.service.ts";
import type { VersionedPrompt } from "./prompt.service.ts";

const logger = createLogger("langwatch:prompt-read-service");

type VersionedPromptMapper = (
  config: Omit<LlmConfigWithLatestVersion, "deletedAt">,
  tags: Array<{ name: string; versionId: string }>,
) => VersionedPrompt;

export class PromptReadService {
  private readonly repository: LlmConfigRepository;
  private readonly tagLookup: PromptTagLookupService;
  private readonly toVersionedPrompt: VersionedPromptMapper;

  static create(options: {
    repository: LlmConfigRepository;
    tagLookup: PromptTagLookupService;
    toVersionedPrompt: VersionedPromptMapper;
  }): PromptReadService {
    return new PromptReadService(options);
  }

  private constructor(options: {
    repository: LlmConfigRepository;
    tagLookup: PromptTagLookupService;
    toVersionedPrompt: VersionedPromptMapper;
  }) {
    this.repository = options.repository;
    this.tagLookup = options.tagLookup;
    this.toVersionedPrompt = options.toVersionedPrompt;
  }

  /**
   * Get all prompts for a project
   */
  async getAllPrompts(params: {
    projectId: string;
    organizationId?: string;
    version?: "latest" | "all";
  }): Promise<VersionedPrompt[]> {
    const { projectId } = params;

    const organizationId =
      params.organizationId ?? (await this.getOrganizationIdFromProjectId(projectId));

    const configs = await this.repository.getAllWithLatestVersion({
      projectId,
      organizationId,
    });

    const latestVersionIds = configs
      .map((c) => c.latestVersion.id)
      .filter((id): id is string => !!id);
    const tagsByVersionId = await this.tagLookup.getTagsByVersionIds({
      versionIds: latestVersionIds,
      projectId,
    });

    return configs.map((config) => {
      const latestVersionId = config.latestVersion.id ?? "";

      return this.toVersionedPrompt(
        config,
        withLatestTag({
          tags: tagsByVersionId.get(latestVersionId) ?? [],
          currentVersionId: latestVersionId,
          latestVersionId,
        }),
      );
    });
  }

  /**
   * Gets a prompt by ID or handle. If a handle is provided, it is formatted
   * with the organization and project context.
   */
  async tryGetPromptByIdOrHandle(params: {
    idOrHandle: string;
    projectId: string;
    version?: number;
    organizationId?: string;
    versionId?: string;
    /** Optional: fetch the version pointed to by this tag */
    tag?: string;
  }): Promise<VersionedPrompt | null> {
    const { idOrHandle, projectId } = params;

    this.assertVersionOrTag(params);

    const organizationId =
      params.organizationId ?? (await this.getOrganizationIdFromProjectId(projectId));

    // `latest` is a virtual tag that is never stored in the PromptTag table
    // (see parsePromptShorthand, which also normalizes it away). Treat
    // `tag: "latest"` as "no tag filter" so that what we advertise in the
    // response (tags: [{name: "latest"}]) is round-trippable via ?tag=latest.
    const normalizedTag = params.tag === "latest" ? undefined : params.tag;

    // If a tag is provided, resolve it to a versionId
    let resolvedVersionId = params.versionId;
    if (normalizedTag) {
      const config = await this.repository.tryGetPromptByIdOrHandle({
        idOrHandle,
        projectId,
        organizationId,
      });

      if (!config) {
        return null;
      }

      resolvedVersionId = await this.tagLookup.versionIdForTag({
        idOrHandle,
        configId: config.id,
        tagName: normalizedTag,
        organizationId,
        projectId,
      });
    }

    const config = await this.repository.tryGetConfigByIdOrHandleWithLatestVersion({
      idOrHandle,
      projectId,
      organizationId,
      version: params.version,
      versionId: resolvedVersionId,
    });

    if (!config) {
      return null;
    }

    const currentVersionId = config.latestVersion.id ?? "";
    const latestVersionId = await this.getLatestVersionIdForConfig({
      configId: config.id,
      projectId,
    });

    return this.withTagsForVersion({ config, projectId, currentVersionId, latestVersionId });
  }

  /** `version`/`versionId` and `tag` both say which version to return, so only one may be given. */
  private assertVersionOrTag(params: {
    idOrHandle: string;
    version?: number;
    versionId?: string;
    tag?: string;
  }): void {
    if (!params.tag || (params.version === undefined && params.versionId === undefined)) {
      return;
    }

    logger.warn(
      {
        idOrHandle: params.idOrHandle,
        tag: params.tag,
        version: params.version,
        versionId: params.versionId,
      },
      "Mutual exclusion: cannot specify both version/versionId and tag",
    );

    throw new TagValidationError(
      "Cannot specify both 'version'/'versionId' and 'tag'. Use one or the other.",
    );
  }

  // The prompt as the API returns it. Only the assignments for the versions we need are
  // fetched — the returned version, and the latest one when it differs — not the config's
  // whole tag history.
  private async withTagsForVersion(params: {
    config: Omit<LlmConfigWithLatestVersion, "deletedAt">;
    projectId: string;
    currentVersionId: string;
    latestVersionId: string;
  }): Promise<VersionedPrompt> {
    const { config, projectId, currentVersionId, latestVersionId } = params;
    const versionIdsToQuery = Array.from(
      new Set([currentVersionId, latestVersionId].filter((id): id is string => !!id)),
    );
    const tagsByVersionId = await this.tagLookup.getTagsByVersionIds({
      versionIds: versionIdsToQuery,
      projectId,
    });

    return this.toVersionedPrompt(
      config,
      withLatestTag({
        tags: tagsByVersionId.get(currentVersionId) ?? [],
        currentVersionId,
        latestVersionId,
      }),
    );
  }

  /**
   * Get all versions for a prompt
   */
  async getAllVersions(params: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<VersionedPrompt[]> {
    // If no organizationId is provided, get it from the projectId
    const organizationId: string =
      params.organizationId ?? (await this.getOrganizationIdFromProjectId(params.projectId));

    // Get the config
    const config = await this.repository.tryGetPromptByIdOrHandle({
      idOrHandle: params.idOrHandle,
      projectId: params.projectId,
      organizationId,
    });

    // If the config doesn't exist, return an empty array
    if (!config) {
      throw new NotFoundError("Prompt not found");
    }

    // Get the versions
    const rawVersions = await this.repository.versions.getVersionsForConfigByIdOrHandle({
      idOrHandle: params.idOrHandle,
      projectId: params.projectId,
      organizationId,
    });

    const versions = rawVersions.map((v) => ({
      ...parseLlmConfigVersion(v),
      runtimeParameters: parseRuntimeParameters(v.runtimeParameters),
    }));

    const versionIds = versions.map((v) => v.id).filter((id): id is string => !!id);
    const tagsByVersionId = await this.tagLookup.getTagsByVersionIds({
      versionIds,
      projectId: params.projectId,
    });

    // Repo returns versions sorted by createdAt desc, so versions[0] is latest.
    const latestVersionId = versions[0]?.id ?? "";

    return versions.map((version) =>
      this.toVersionedPrompt(
        {
          ...config,
          latestVersion: version,
        },
        withLatestTag({
          tags: tagsByVersionId.get(version.id ?? "") ?? [],
          currentVersionId: version.id ?? "",
          latestVersionId,
        }),
      ),
    );
  }

  /**
   * Returns the id of the latest (by createdAt desc) version for a config, or an empty
   * string when no version exists.
   */
  private async getLatestVersionIdForConfig(params: {
    configId: string;
    projectId: string;
  }): Promise<string> {
    return (
      (await this.repository.versions.tryFindLatestId({
        configId: params.configId,
        projectId: params.projectId,
      })) ?? ""
    );
  }

  private async getOrganizationIdFromProjectId(projectId: string): Promise<string> {
    return this.repository.getOrganizationIdForProject(projectId);
  }
}
