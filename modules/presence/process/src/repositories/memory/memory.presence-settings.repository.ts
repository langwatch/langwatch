import {
  type FoldedProject,
  type FoldedSetting,
  PresenceSettingsRepository,
  type RecordedSetting,
} from "../presence-settings.repository.ts";

type ProjectRow = { organizationId: string; setting: RecordedSetting | null };

export class MemoryPresenceSettingsRepository extends PresenceSettingsRepository {
  readonly #projects = new Map<string, ProjectRow>();
  readonly #organizations = new Map<string, RecordedSetting>();

  private constructor() {
    super();
  }

  static create(): MemoryPresenceSettingsRepository {
    return new MemoryPresenceSettingsRepository();
  }

  async recordProject({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string;
  }): Promise<void> {
    const row = this.#projects.get(projectId);
    this.#projects.set(projectId, { organizationId, setting: row?.setting ?? null });
  }

  async recordProjectSetting({
    projectId,
    organizationId,
    presenceEnabled,
    occurredAt,
  }: { projectId: string; organizationId: string } & RecordedSetting): Promise<void> {
    const stored = this.#projects.get(projectId)?.setting ?? null;
    const setting = newer({ stored, given: { presenceEnabled, occurredAt } });
    this.#projects.set(projectId, { organizationId, setting });
  }

  async recordOrganizationSetting({
    organizationId,
    presenceEnabled,
    occurredAt,
  }: { organizationId: string } & RecordedSetting): Promise<void> {
    const stored = this.#organizations.get(organizationId) ?? null;
    this.#organizations.set(
      organizationId,
      newer({ stored, given: { presenceEnabled, occurredAt } }),
    );
  }

  async getProject({ projectId }: { projectId: string }): Promise<FoldedProject> {
    const row = this.#projects.get(projectId);
    if (!row) return { kind: "unfolded" };
    return { kind: "folded", organizationId: row.organizationId, setting: settingOf(row.setting) };
  }

  async getOrganizationSetting({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<FoldedSetting> {
    return settingOf(this.#organizations.get(organizationId) ?? null);
  }
}

function settingOf(recorded: RecordedSetting | null): FoldedSetting {
  if (recorded === null) return "unrecorded";
  return recorded.presenceEnabled ? "on" : "off";
}

function newer({
  stored,
  given,
}: {
  stored: RecordedSetting | null;
  given: RecordedSetting;
}): RecordedSetting {
  return stored !== null && stored.occurredAt > given.occurredAt ? stored : given;
}
