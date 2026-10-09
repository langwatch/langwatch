/**
 * The query domain's app.
 *
 * `createProjectApp` for the canonical envelope and the app-context/logger
 * plumbing, but NOT for its project-auth chain: the routes declare
 * `handlerManagedAuth` and prepend their own key-auth middleware
 * ({@link createUnifiedKeyAuthMiddleware}), which authenticates ANY API key
 * without demanding a project so the door can fan the key out across every
 * project it can read (#8085). The app's variables are widened with
 * {@link KeyAuthVariables} so the handlers read `keyPrincipal` off context.
 *
 * No `onError` of its own: the canonical envelope `createProjectApp` installs
 * is the whole error contract, the same one every other REST family answers
 * with.
 *
 * The directory this file sits in is only where the repo keeps route modules,
 * and carries no routing meaning: the base path below is what mounts.
 *
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
 */

import { createProjectApp } from "~/server/api/security";
import type { KeyAuthVariables } from "~/server/api-key/auth-middleware";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { registerQueryRoutes } from "./app.v1";

patchZodOpenapi();

/**
 * Version-first, unlike the families that predate it.
 *
 * `/api/v1/query` puts the version where every other platform route already
 * carries it, so a consumer holding a base URL does not learn two rules for
 * where `v1` lives. Issue #7565 originally specified `/api/query/v1` and was
 * corrected on purpose; the reversal is recorded on the issue rather than
 * left for a reader to rediscover here.
 */
const BASE_PATH = "/api/v1/query";

/**
 * The canonical envelope, because this is a new family.
 *
 * `legacy` is the flat `{ error }` shape the older families already published
 * and whose consumers parse it; nothing consumes this door yet, so there is
 * no such shape to preserve and the canonical one is what the rest of the
 * platform is converging on.
 */
const secured = createProjectApp<KeyAuthVariables>({
  basePath: BASE_PATH,
  errorEnvelope: "canonical",
});

registerQueryRoutes(secured);

export const app = secured.hono;
