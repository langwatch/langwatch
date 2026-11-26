// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The dormancy window an organisation that never set one reads. */
export const DEFAULT_DORMANT_AFTER_DAYS = 30;

/** An organisation's agent registry settings; an organisation without a row reads the defaults. */
export abstract class AgentRegistrySettingsRepository {
  /** Days without traffic after which a listed agent is dormant; 30 when never set. */
  abstract getDormantAfterDays(input: { organizationId: string }): Promise<number>;
  abstract saveDormantAfterDays(input: { organizationId: string; days: number }): Promise<void>;
}
