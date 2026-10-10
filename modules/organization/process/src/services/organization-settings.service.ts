import {
  OrganizationNotFoundError,
  OrganizationS3SecretRequiredError,
  getOrganizationSettingsInputSchema,
  updateOrganizationSettingsInputSchema,
  type OrganizationSettings,
  type UpdateOrganizationSettingsInput,
  type UpdateOrganizationSettingsResult,
} from "@langwatch/organization-contract";

import type { OrganizationRepository } from "../repositories/organization.repository.ts";
import type { OrganizationLifecycleNoticeService } from "./organization-lifecycle-notice.service.ts";

/** An organization's stored settings: reads, the S3 and sharing guards, presence notices. */
/** Where a stored presence switch is recorded, so presence folds it from its own side (§9). */
export type OrganizationSettingsNotices = Pick<
  OrganizationLifecycleNoticeService,
  "presenceSettingChanged" | "recordStoredPresenceSetting"
>;

export class OrganizationSettingsService {
  static create(deps: {
    repository: OrganizationRepository;
    settingsNotices?: OrganizationSettingsNotices | undefined;
  }): OrganizationSettingsService {
    return new OrganizationSettingsService(deps);
  }

  private constructor(
    private readonly deps: {
      repository: OrganizationRepository;
      settingsNotices?: OrganizationSettingsNotices | undefined;
    },
  ) {}

  async getSettings(input: { organizationId: string }): Promise<OrganizationSettings> {
    const parsed = getOrganizationSettingsInputSchema.parse(input);
    const stored = await this.deps.repository.findStoredSettings(parsed.organizationId);
    if (!stored) {
      throw new OrganizationNotFoundError();
    }

    return stored;
  }

  async updateSettings(
    input: UpdateOrganizationSettingsInput,
    by: Readonly<{ id: string }> | null,
  ): Promise<UpdateOrganizationSettingsResult> {
    const parsed = updateOrganizationSettingsInputSchema.parse(input);
    const keepsSecret = !!parsed.s3Endpoint && parsed.s3SecretAccessKey === undefined;
    if (keepsSecret && !(await this.deps.repository.hasStoredS3Secret(parsed.organizationId))) {
      throw new OrganizationS3SecretRequiredError();
    }
    const stored =
      parsed.traceSharingEnabled === false || parsed.presenceEnabled !== undefined
        ? await this.deps.repository.findStoredSettings(parsed.organizationId)
        : null;
    const wasSharingEnabled =
      parsed.traceSharingEnabled === false && stored?.traceSharingEnabled === true;
    await this.deps.repository.updateSettings(parsed);
    if (
      stored &&
      parsed.presenceEnabled !== undefined &&
      parsed.presenceEnabled !== stored.presenceEnabled
    ) {
      this.deps.settingsNotices?.presenceSettingChanged({
        organizationId: parsed.organizationId,
        presenceEnabled: parsed.presenceEnabled,
        changedByUserId: by?.id ?? null,
      });
    }

    return { traceShareRevocationRequired: wasSharingEnabled };
  }

  async recordStoredPresenceSetting(input: { organizationId: string }): Promise<boolean> {
    const stored = await this.deps.repository.findStoredSettings(input.organizationId);
    if (!stored) return false;
    if (!this.deps.settingsNotices) throw new Error("organization settings notices are not wired");
    await this.deps.settingsNotices.recordStoredPresenceSetting({
      organizationId: input.organizationId,
      presenceEnabled: stored.presenceEnabled,
    });
    return true;
  }

  /** As `/me` read it: the configured contact, else the longest-seated enabled administrator. */
  async findSupportContact(input: { organizationId: string }): Promise<string | null> {
    const settings = await this.getSettings(input);
    if (settings.supportContact) return settings.supportContact;
    return this.deps.repository.findFirstAdministratorEmail(input.organizationId);
  }
}
