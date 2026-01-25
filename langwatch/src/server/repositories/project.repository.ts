import type { PrismaClient, Project } from "@prisma/client";
import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
} from "~/utils/constants";

/**
 * Project configuration with resolved defaults.
 * All model fields are guaranteed to have a value (resolved from defaults).
 */
export interface ProjectConfig {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
  teamId: string;
  language: string;
  framework: string;
  /** Resolved default model - always has a value */
  defaultModel: string;
  /** Resolved embeddings model - always has a value */
  embeddingsModel: string;
  /** Resolved topic clustering model - always has a value */
  topicClusteringModel: string;
  piiRedactionLevel: Project["piiRedactionLevel"];
  capturedInputVisibility: Project["capturedInputVisibility"];
  capturedOutputVisibility: Project["capturedOutputVisibility"];
  traceSharingEnabled: boolean;
  userLinkTemplate: string | null;
  firstMessage: boolean;
  integrated: boolean;
}

/**
 * Repository for project configuration access.
 * Single Responsibility: Database access for project config with resolved defaults.
 *
 * This is the single source of truth for project configuration.
 * All services should use this repository instead of querying prisma.project directly.
 */
export class ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ProjectRepository {
    return new ProjectRepository(prisma);
  }

  /**
   * Gets project configuration with resolved defaults.
   * Returns null if project not found.
   *
   * Default resolution:
   * - defaultModel: project.defaultModel ?? DEFAULT_MODEL
   * - embeddingsModel: project.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL
   * - topicClusteringModel: project.topicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL
   */
  async getProjectConfig(projectId: string): Promise<ProjectConfig | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return null;
    }

    return this.resolveDefaults(project);
  }

  /**
   * Resolves default values for optional project fields.
   */
  private resolveDefaults(project: Project): ProjectConfig {
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      apiKey: project.apiKey,
      teamId: project.teamId,
      language: project.language,
      framework: project.framework,
      defaultModel: project.defaultModel ?? DEFAULT_MODEL,
      embeddingsModel: project.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL,
      topicClusteringModel:
        project.topicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL,
      piiRedactionLevel: project.piiRedactionLevel,
      capturedInputVisibility: project.capturedInputVisibility,
      capturedOutputVisibility: project.capturedOutputVisibility,
      traceSharingEnabled: project.traceSharingEnabled,
      userLinkTemplate: project.userLinkTemplate,
      firstMessage: project.firstMessage,
      integrated: project.integrated,
    };
  }
}
