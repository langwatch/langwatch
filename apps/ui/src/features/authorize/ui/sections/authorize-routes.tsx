/**
 * Which page keys the two handoff addresses answer: the host, and nothing
 * else. Neither carries a page-level grant — `/authorize` answers an empty
 * key rather than refusing, `/mcp/authorize` needs its redirect to run first.
 */

import { authorizeScreens } from "@langwatch/api-key-web/screens/authorize";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { AuthorizeHost } from "./authorize-host";

export const authorizePageLoaders: UiPageLoaderRegistry = {
  "pages/authorize": uiPage({
    screen: async () => ({ default: (await authorizeScreens.authorize()).default }),
    host: AuthorizeHost,
  }),
  "pages/mcp/authorize": uiPage({
    screen: async () => ({ default: (await authorizeScreens.mcpAuthorize()).default }),
    host: AuthorizeHost,
  }),
};
