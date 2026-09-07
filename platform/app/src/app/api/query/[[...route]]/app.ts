/**
 * The query domain's app.
 *
 * `createProjectApp`, because a project API key reaches exactly its own
 * project and that is the single-project slice this family ships first. The
 * cross-project fan-out (issue #7565) would mount on `createOrgApp` instead,
 * and would choose its own gate there.
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
const secured = createProjectApp({
  basePath: BASE_PATH,
  errorEnvelope: "canonical",
});

registerQueryRoutes(secured);

export const app = secured.hono;
