// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SlackNoticeMessage } from "@langwatch/internal-slack";

/** LangWatch's own upgrade diagnostics Slack channel; never a Slack a customer configured. */
export abstract class UpgradeDiagnosticsAnnouncementChannel {
  abstract post(message: SlackNoticeMessage): Promise<void>;
}
