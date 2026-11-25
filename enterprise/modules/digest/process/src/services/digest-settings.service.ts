// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestSettings } from "@langwatch/enterprise-digest-contract";

import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";

type Deps = Readonly<{ audience: DigestAudienceRepository }>;

/** The operator's switches: which organizations are sent to, and whether the send is armed. */
export class DigestSettingsService {
  static create(deps: Deps): DigestSettingsService {
    return new DigestSettingsService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  async read(): Promise<DigestSettings> {
    const [settings, enrolled] = await Promise.all([
      this.deps.audience.getSettings(),
      this.deps.audience.findEnrolled(),
    ]);
    return { armed: settings.armed, enrolledOrganizationIds: enrolled.toSorted() };
  }

  async setEnrolled(input: {
    organizationId: string;
    enrolled: boolean;
    by: string;
  }): Promise<DigestSettings> {
    await this.deps.audience.setEnrolled(input);
    return this.read();
  }

  async setArmed({ armed }: { armed: boolean }): Promise<DigestSettings> {
    await this.deps.audience.setArmed({ armed });
    return this.read();
  }
}
