/**
 * What a browser installs when it installs coding-agent: no screen of its
 * own — it lends its activity tables to user's workspace screens.
 */

import { defineBrowserModule } from "@langwatch/browser";

/** The pull requests and sessions tables, lent to user (§3.4 rule 7). */
export const codingAgentWeb = defineBrowserModule("coding-agent").withCapabilities({
  codingAgentPullRequestsTable: {
    load: async () => ({
      default: (await import("./lent-activity-tables.tsx")).LentPullRequestsTable,
    }),
  },
  codingAgentSessionsTable: {
    load: async () => ({
      default: (await import("./lent-activity-tables.tsx")).LentSessionsTable,
    }),
  },
});
