/** A presence setting as presence folded it; `unrecorded` until a fact names one. */
export type FoldedSetting = "on" | "off" | "unrecorded";

/** One project's folded presence facts: unfolded until its creation or a setting is folded. */
export type FoldedProject =
  | Readonly<{ kind: "unfolded" }>
  | Readonly<{ kind: "folded"; organizationId: string; setting: FoldedSetting }>;

/** One presence setting as a fact recorded it, ordered by when it was recorded. */
export type RecordedSetting = Readonly<{ presenceEnabled: boolean; occurredAt: number }>;

/**
 * Presence's durable fold of project's and organization's presence-setting facts. Never expires.
 * A setting write keeps whichever of the stored and given settings is newer by `occurredAt`.
 */
export abstract class PresenceSettingsRepository {
  abstract recordProject(input: { projectId: string; organizationId: string }): Promise<void>;
  abstract recordProjectSetting(
    input: { projectId: string; organizationId: string } & RecordedSetting,
  ): Promise<void>;
  abstract recordOrganizationSetting(
    input: { organizationId: string } & RecordedSetting,
  ): Promise<void>;
  abstract getProject(input: { projectId: string }): Promise<FoldedProject>;
  abstract getOrganizationSetting(input: { organizationId: string }): Promise<FoldedSetting>;
}
