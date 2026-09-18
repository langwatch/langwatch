/**
 * What a browser installs when it installs suite: nothing routed. Suite owns
 * no screens or drawers today; scenario's declaration routes every Suite-run
 * page and dialog, importing these components directly.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const suiteWeb = defineWebModule("suite");
