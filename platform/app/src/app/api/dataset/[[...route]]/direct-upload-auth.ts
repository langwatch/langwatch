/**
 * Auth for the browser→S3 direct-upload routes (ADR-032 D4).
 *
 * These three routes (`/direct-upload`, `/direct-upload/:id/finalize`,
 * `/direct-upload/:id/retry`) are driven by the in-app upload UI, which
 * authenticates with the logged-in user's NextAuth session cookie — NOT an API
 * key. The rest of the dataset REST surface is `requires("datasets:manage")`
 * (API-key only via `authMiddleware`), which would 401 a cookie-only browser
 * request. So these routes opt into the `handlerManagedAuth` pattern (same as
 * the experiments-v3 session endpoints) and resolve auth here.
 *
 * Dual path so the routes keep working for both callers:
 *   1. NextAuth session cookie (the upload UI) — verified with
 *      `probeProjectPermission`.
 *   2. Project API key / legacy key / PAT (parity with the rest of the surface)
 *      — resolved by the process-owned API Key service and checked with
 *        `enforceApiKeyCeiling`.
 *
 * `projectId` comes from the request (the route reads it from the body/param
 * and passes it in) since there is no `authMiddleware` to set `c.get("project")`.
 */

import type { Context } from "hono";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { appFromContext } from "~/app/api/middleware/app-context";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { getServerAuthSession } from "~/server/auth";

const PERMISSION = "datasets:manage" as const;

/**
 * CSRF defense-in-depth for the COOKIE-authed path only. The direct-upload POST
 * is a `multipart/form-data` "simple request" (no preflight) authenticated by the
 * NextAuth session cookie, so without this a malicious cross-origin page could
 * forge it with the victim's cookie. (The API-key path is not exposed: keys
 * aren't auto-attached by the browser.)
 *
 * `Sec-Fetch-Site` is the primary signal — set by every modern browser based on
 * the real request initiator and unaffected by reverse proxies; `cross-site` is
 * exactly the CSRF vector, while `same-origin`/`same-site`/`none` (direct nav)
 * are legitimate. For older browsers that omit it, fall back to comparing the
 * `Origin` host against the forwarded/Host header.
 */
function isCrossSiteRequest(c: Context): boolean {
  const secFetchSite = c.req.header("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "cross-site";
  }
  const origin = c.req.header("origin");
  // Fail CLOSED: with neither `Sec-Fetch-Site` nor `Origin` there is no positive
  // same-site signal, so treat it as cross-site. A real same-site upload from
  // the UI always carries one of the two (modern browsers send `Sec-Fetch-Site`;
  // older ones send `Origin` on a cross-origin POST), so this only rejects
  // pathological/forged contexts — never a legitimate cookie-authed upload.
  if (!origin) return true;
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "";
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // malformed Origin → treat as cross-site
  }
}

export type DirectUploadAuthResult =
  | { ok: true; projectId: string; teamId: string }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
      /**
       * The full handled body for failures that have one (currently only the
       * API-key ceiling denial: code, permission, tips, docsUrl). Routes should
       * answer with this in preference to `error`, which is only a sentence.
       */
      body?: object;
    };

/**
 * Authorize a direct-upload request for `projectId` via session cookie OR API
 * key, requiring `datasets:manage`. Returns the resolved `projectId` + `teamId`
 * (the latter so the route can enforce resource limits in-handler) or a
 * discriminated error the route maps to a JSON response.
 */
export async function authorizeDirectUpload(
  c: Context,
  projectId: string,
): Promise<DirectUploadAuthResult> {
  // 1. Session cookie (the upload UI).
  const session = await getServerAuthSession({ app: c.app, req: c.req.raw });
  if (session) {
    // CSRF: a cookie-authed state change must originate same-site. Reject a
    // cross-site request before any permission check / mutation.
    if (isCrossSiteRequest(c)) {
      return {
        ok: false,
        status: 403,
        error: "Cross-site request blocked.",
      };
    }
    const permitted = await probeProjectPermission({ session }, projectId, PERMISSION);
    if (!permitted) {
      return {
        ok: false,
        status: 403,
        error: "You do not have permission to upload to this dataset.",
      };
    }
    const project = await appFromContext(c).projects.tryGetById(projectId);
    if (!project) {
      return { ok: false, status: 403, error: "Project not found" };
    }
    return { ok: true, projectId, teamId: project.teamId };
  }

  // 2. API key / legacy key / PAT (parity with the rest of the surface).
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) {
    return {
      ok: false,
      status: 401,
      error: "You must be logged in to access this endpoint.",
    };
  }

  const app = appFromContext(c);
  const resolved = await app.apiKeys.tryResolveToken({
    token: credentials.token,
    projectId: credentials.projectId ?? projectId,
  });
  if (!resolved || resolved.project.id !== projectId) {
    return { ok: false, status: 401, error: "Invalid credentials" };
  }

  try {
    await enforceApiKeyCeiling({ resolved, permission: PERMISSION });
  } catch (error) {
    const denial = apiKeyCeilingDenialResponse(error);
    // The ceiling only ever denies with 403; narrowed here so the result keeps
    // its `401 | 403` contract with the routes.
    return {
      ok: false,
      status: 403,
      error: denial.message,
      body: denial.body,
    };
  }

  // Telemetry parity with the rest of the API-key surface: fire-and-forget
  // bump of `lastUsedAt` on a successful API-key auth (no-op for legacy keys,
  // which carry no `apiKeyId`). Matches the experiments-v3 `markUsed` pattern.
  if (resolved.type === "apiKey") {
    app.apiKeys.markUsed({ id: resolved.apiKeyId });
  }

  return {
    ok: true,
    projectId,
    teamId: resolved.project.teamId,
  };
}
