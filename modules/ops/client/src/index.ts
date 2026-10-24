/** What ops lends other modules, by token (ARCHITECTURE.md §10.1). */

import { lentComponent } from "@langwatch/browser-host/lent";
import { uiTokens } from "@langwatch/module";

/** Home's "Action needed for updates" card needs nothing handed in: it reads ops itself. */
export type UpgradeActionNeededProps = Record<string, never>;

const ops = uiTokens("ops");

export const UpgradeActionNeededToken =
  ops.component<UpgradeActionNeededProps>("upgradeActionNeeded");

/** The tokens above as ready components: a borrower imports these and writes no wrapper (§10.1). */
export const UpgradeActionNeeded = lentComponent(UpgradeActionNeededToken);
