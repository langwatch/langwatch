import type { PaginatedProjects, Project, ProjectWithTeam, UpdateProjectInput } from "./project.ts";
import type { TopicClusteringRequest } from "./project.responses.ts";
import { featureApi } from "@langwatch/runtime-composition/contract";
import type { Instant } from "@langwatch/time";

export interface ProjectApi {
  tryGetById(id: string): Promise<Project | null>;
  getOrganizationId(projectId: string): Promise<string>;
  getWithTeam(id: string): Promise<ProjectWithTeam>;
  tryGetWithTeam(id: string): Promise<ProjectWithTeam | null>;
  listByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects>;
  listByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]>;
  create(
    input: Readonly<{
      organizationId: string;
      teamId?: string | undefined;
      newTeamName?: string | undefined;
      name: string;
      language: string;
      framework: string;
    }>,
    by: Readonly<{ id: string }>,
  ): Promise<Project>;
  updateSettings(input: Readonly<UpdateProjectInput & { projectId: string }>): Promise<Project>;
  archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }>;
  regenerateLegacyProjectKey(input: Readonly<{ projectId: string }>): Promise<string>;
  requestTopicClustering(
    input: Readonly<{ projectId: string }>,
    by: Readonly<{ id: string }>,
  ): Promise<TopicClusteringRequest>;
  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Instant }): Promise<void>;
}

export const ProjectApi = featureApi<ProjectApi>("project");
