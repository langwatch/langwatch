/** A project's presence settings as their owners hold them, or that they hold no such project. */
export type PresenceProjectSettings =
  | Readonly<{ outcome: "known"; projectEnabled: boolean; organizationEnabled: boolean }>
  | Readonly<{ outcome: "unknown" }>;

/**
 * Project's `Project` and organization's `Team` and `Organization` rows, read through their
 * declared shares (round 46 E1, R40), never a copy. Spec: modules/presence/specs/presence.feature
 */
export abstract class PresenceSettingsRepository {
  /** Unknown is an answer, not a failure: presence treats the project as not enabled. */
  abstract getSettings(input: { projectId: string }): Promise<PresenceProjectSettings>;
}
