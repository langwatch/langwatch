/** What ops lends other modules, by token (ARCHITECTURE.md §10.1). */

import { uiTokens } from "@langwatch/module";

/** Home's "Action needed for updates" card needs nothing handed in: it reads ops itself. */
export type UpgradeActionNeededProps = Record<string, never>;

const ops = uiTokens("ops");

export const UpgradeActionNeededToken =
  ops.component<UpgradeActionNeededProps>("upgradeActionNeeded");
