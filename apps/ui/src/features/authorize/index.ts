/**
 * Handoff: two screens in `@langwatch/api-key-web`. NO API binding of its
 * own — the one read is `organization.getAll` on `features/api-key`'s
 * already-installed `apiKeyApi`.
 */

import { authorizePageLoaders } from "./ui/sections/authorize-routes";

export { authorizePageLoaders };
