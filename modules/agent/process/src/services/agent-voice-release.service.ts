/**
 * Voice agents are behind `release_voice_agents_enabled` (AC29): every write that can leave a
 * voice agent's config in a project asks that project's flag, and is refused while it is off.
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { VoiceAgentsDisabledError } from "@langwatch/agent-contract";
import { type FeatureFlagApi, VOICE_AGENTS_FLAG_KEY } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

export class AgentVoiceReleaseService {
  static create(options: {
    featureFlags: FeatureFlagApi;
    projects: Pick<ProjectApi, "findOrganizationId">;
  }): AgentVoiceReleaseService {
    return new AgentVoiceReleaseService(options.featureFlags, options.projects);
  }

  private constructor(
    private readonly featureFlags: FeatureFlagApi,
    private readonly projects: Pick<ProjectApi, "findOrganizationId">,
  ) {}

  /** Refuses a voice agent landing in a project whose flag is off; other types pass unread. */
  async assertWritable({
    type,
    projectIds,
  }: {
    type: string | null | undefined;
    projectIds: readonly string[];
  }): Promise<void> {
    if (type !== "voice") return;
    for (const projectId of projectIds) {
      const organizationId = await this.projects.findOrganizationId(projectId);
      const enabled = await this.featureFlags.isEnabled(VOICE_AGENTS_FLAG_KEY, {
        kind: "project",
        projectId,
        ...(organizationId === undefined ? {} : { organizationId }),
      });
      if (!enabled) throw new VoiceAgentsDisabledError();
    }
  }
}
