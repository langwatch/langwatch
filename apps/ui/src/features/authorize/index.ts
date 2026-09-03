/**
 * The handoff family, as this application composes it.
 *
 * The two screens live in `@langwatch/api-key-web` alongside the settings screen
 * that mints the credentials they hand out; what belongs to the application is
 * which page keys the addresses answer and the host port that answers for the
 * project, the switcher that chooses it, the base key and the MCP exchange.
 *
 * THERE IS NO API BINDING HERE ON PURPOSE. These screens declare no transport of
 * their own — the one read behind them is `organization.getAll` on
 * `@langwatch/api-key-web`'s own `apiKeyApi`, which `features/api-key` already
 * installs. A second binding of the same instance would mount a second Provider
 * over one cache.
 */

import { authorizePageLoaders } from "./ui/sections/authorize-routes";

export { authorizePageLoaders };
