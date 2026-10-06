/**
 * What a browser installs when it installs coding-agent: no screen of its
 * own — it lends its activity tables to user's workspace screens.
 */

import { defineBrowserModule } from "@langwatch/browser";
import {
  CodingAgentPullRequestsTableToken,
  CodingAgentSessionsTableToken,
} from "@langwatch/coding-agent-contract";

/** The pull requests and sessions tables, lent to user by token (§10.1). */
export const codingAgentWeb = defineBrowserModule("coding-agent")
  .lends(CodingAgentPullRequestsTableToken, {
    load: async () => ({
      default: (await import("./lent-activity-tables.tsx")).LentPullRequestsTable,
    }),
  })
  .lends(CodingAgentSessionsTableToken, {
    load: async () => ({
      default: (await import("./lent-activity-tables.tsx")).LentSessionsTable,
    }),
  });
