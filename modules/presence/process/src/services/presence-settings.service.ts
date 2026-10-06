import type {
  RecordedSetting,
  PresenceSettingsRepository,
} from "../repositories/presence-settings.repository.ts";

/**
 * Folds project's and organization's presence-setting facts and answers from the fold. A project
 * is on when it was created or its setting recorded, its own setting is on (or unrecorded: the
 * stored default is on) and its organization's is on (or unrecorded, likewise).
 */
export class PresenceSettingsService {
  private constructor(private readonly repository: PresenceSettingsRepository) {}

  static create({
    repository,
  }: {
    repository: PresenceSettingsRepository;
  }): PresenceSettingsService {
    return new PresenceSettingsService(repository);
  }

  projectCreated(input: { projectId: string; organizationId: string }): Promise<void> {
    return this.repository.recordProject(input);
  }

  projectSettingChanged(
    input: { projectId: string; organizationId: string } & RecordedSetting,
  ): Promise<void> {
    return this.repository.recordProjectSetting(input);
  }

  organizationSettingChanged(input: { organizationId: string } & RecordedSetting): Promise<void> {
    return this.repository.recordOrganizationSetting(input);
  }

  async isEnabledForProject({ projectId }: { projectId: string }): Promise<boolean> {
    const project = await this.repository.getProject({ projectId });
    if (project.kind === "unfolded" || project.setting === "off") return false;

    const organization = await this.repository.getOrganizationSetting({
      organizationId: project.organizationId,
    });
    return organization !== "off";
  }
}
