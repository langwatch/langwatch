// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  DigestImpersonationRefusedError,
  type DigestPreference,
  type DigestSettings,
} from "@langwatch/enterprise-digest-contract";

import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";

type Deps = Readonly<{ audience: DigestAudienceRepository; now: () => number }>;

/** Recorded where an opt-out names the send it came from: this one came from the settings page. */
export const SETTINGS_OPT_OUT_SOURCE = "settings";

/** The operator's kill switch, and each person's own opt-out. */
export class DigestSettingsService {
  static create(deps: Deps): DigestSettingsService {
    return new DigestSettingsService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  async read(): Promise<DigestSettings> {
    const settings = await this.deps.audience.getSettings();
    return { armed: settings.armed };
  }

  async setArmed({ armed }: { armed: boolean }): Promise<DigestSettings> {
    await this.deps.audience.setArmed({ armed });
    return this.read();
  }

  /** The same opt-out the unsubscribe link writes, so the two always agree. */
  async preference({ userId }: { userId: string }): Promise<DigestPreference> {
    const unsubscribed = await this.deps.audience.findUnsubscribed({ userIds: [userId] });
    return { subscribed: unsubscribed.length === 0 };
  }

  async setPreference({
    userId,
    subscribed,
    impersonatorId,
  }: {
    userId: string;
    impersonatorId?: string | undefined;
  } & DigestPreference): Promise<DigestPreference> {
    if (impersonatorId) throw new DigestImpersonationRefusedError();
    if (subscribed) {
      await this.deps.audience.resubscribe({ userId });
    } else {
      await this.deps.audience.unsubscribe({
        userId,
        sendId: SETTINGS_OPT_OUT_SOURCE,
        at: this.deps.now(),
      });
    }
    return this.preference({ userId });
  }
}
