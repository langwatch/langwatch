/**
 * What every installed web module declared through `withCapabilities`, in
 * install order, for the hosts modules mount themselves. ARCHITECTURE.md §10.1.
 */

import { uiDeclarations } from "@langwatch/browser-host/declarations";
import { webModules } from "@langwatch/installed-web-modules";

export const installedUiDeclarations = uiDeclarations(webModules);
