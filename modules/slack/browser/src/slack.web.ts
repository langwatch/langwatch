/** What a browser installs for slack: the `slackConnection` drawer settings and automation open. */

import { defineBrowserModule } from "@langwatch/browser";

export const slackWeb = defineBrowserModule("slack")
  /** The name is the wire (§10): settings and automation's Slack step open it by address. */
  .withDrawers({
    slackConnection: {
      load: async () => ({
        default: (await import("./ui/sections/slack-connection-drawer.tsx")).SlackConnectionDrawer,
      }),
    },
  });
