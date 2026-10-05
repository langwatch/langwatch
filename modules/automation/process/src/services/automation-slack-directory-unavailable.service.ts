import {
  ApiAutomationUnavailableError,
  type SlackChannelListing,
} from "@langwatch/automation-contract";

import type { AutomationSlackDirectory } from "../app/automation.app.ts";

/**
 * The Slack conversations a bot token can see, absent: listing a
 * workspace's channels is a live call to Slack's API, and this process
 * makes none.
 */
export class AutomationSlackDirectoryUnavailableService implements AutomationSlackDirectory {
  static create(): AutomationSlackDirectoryUnavailableService {
    return new AutomationSlackDirectoryUnavailableService();
  }

  private constructor() {}

  list(): Promise<SlackChannelListing> {
    return Promise.reject(
      new ApiAutomationUnavailableError(
        "run a Slack transport, so it cannot list a workspace's channels",
      ),
    );
  }
}
