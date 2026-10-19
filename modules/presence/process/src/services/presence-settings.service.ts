import { nowInstant } from "@langwatch/time";

import type { PresenceSettingsRepository } from "../repositories/presence-settings.repository.ts";

/** How long one answer stands before the owners' rows are read again (coordinator, E1-presence). */
export const PRESENCE_SETTINGS_TTL_MS = 30_000;

/**
 * Answers whether presence is on for a project from the rows its owners hold (R40): on when
 * project holds the project with its own setting on and its organization's setting on. Each
 * answer is kept in process for {@link PRESENCE_SETTINGS_TTL_MS}, so a toggle may lag that long.
 */
export class PresenceSettingsService {
  readonly #answers = new Map<string, { enabled: boolean; expiresAt: number }>();

  private constructor(
    private readonly repository: PresenceSettingsRepository,
    private readonly now: () => number,
  ) {}

  static create({
    repository,
    now = () => nowInstant().epochMilliseconds,
  }: {
    repository: PresenceSettingsRepository;
    now?: () => number;
  }): PresenceSettingsService {
    return new PresenceSettingsService(repository, now);
  }

  async isEnabledForProject({ projectId }: { projectId: string }): Promise<boolean> {
    const at = this.now();
    const held = this.#answers.get(projectId);
    if (held && held.expiresAt > at) return held.enabled;

    const settings = await this.repository.getSettings({ projectId });
    const enabled =
      settings.outcome === "known" && settings.projectEnabled && settings.organizationEnabled;
    this.#answers.set(projectId, { enabled, expiresAt: at + PRESENCE_SETTINGS_TTL_MS });
    return enabled;
  }
}
