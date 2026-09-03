/**
 * Auth for the browser -> S3 direct-upload routes (ADR-032 D4).
 *
 * These three routes (`/direct-upload`, `/direct-upload/:id/finalize`,
 * `/direct-upload/:id/retry`) are driven by the in-app upload UI, which
 * authenticates with the logged-in user's session cookie — NOT an API key. The
 * rest of the dataset REST surface is `requires("datasets:manage")` (API-key
 * only via the framework chain), which would 401 a cookie-only browser
 * request. So these routes opt into the `handlerManagedAuth` pattern (same as
 * the experiments-v3 session endpoints) and resolve auth here.
 *
 * Dual path so the routes keep working for both callers:
 *   1. The browser session (the upload UI) — verified through the process's
 *      ONE session port, which is the same one the Studio's doors, the
 *      playground and the two generators resolve a person with.
 *   2. Project API key / legacy key / PAT (parity with the rest of the
 *      surface) — resolved and ceiling-checked through the process's ONE
 *      handler-managed credential, which is the same decision the framework
 *      chain makes.
 *
 * `projectId` comes from the request (the route reads it from the body/param
 * and passes it in) since there is no framework chain to set `c.get("project")`.
 */

import type {
  DatasetDirectUploadAuthorization,
  DatasetDirectUploadAuthorizer,
} from "@langwatch/dataset-server";
import type { ProjectService } from "@langwatch/project-contract";
import type { Context } from "hono";

import type { ApiHandlerManagedCredentials } from "../../app/api-handler-managed-credential";
import type { ApiHandlerManagedSessionPort } from "../../app/api-handler-managed-session";

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

/**
 * Authorize a direct-upload request for `projectId` via session cookie OR API
 * key, requiring `datasets:manage`. Returns the resolved `projectId` + `teamId`
 * (the latter so the route can enforce resource limits in-handler) or a
 * discriminated error the route maps to a JSON response.
 */
/**
 * Authorize a direct-upload request for `projectId` via browser session OR API
 * key, requiring `datasets:manage`. Returns the resolved `projectId` + `teamId`
 * (the latter so the route can enforce resource limits in-handler) or a
 * discriminated error the route maps to a JSON response.
 */
export function createDatasetDirectUploadAuthorizer(options: {
  session: ApiHandlerManagedSessionPort;
  credentials: ApiHandlerManagedCredentials;
  projects: () => ProjectService;
}): DatasetDirectUploadAuthorizer {
  const { session, credentials, projects } = options;

  return async function authorizeDirectUpload(
    c: Context,
    projectId: string,
  ): Promise<DatasetDirectUploadAuthorization> {
    // 1. The browser session (the upload UI).
    const person = await session.resolve(c.req.raw);
    if (person) {
      // CSRF: a cookie-authed state change must originate same-site. Reject a
      // cross-site request before any permission check / mutation.
      if (isCrossSiteRequest(c)) {
        return { ok: false, status: 403, error: "Cross-site request blocked." };
      }
      const permitted = await session.permitted({ session: person, projectId, permission: PERMISSION });
      if (!permitted) {
        return {
          ok: false,
          status: 403,
          error: "You do not have permission to upload to this dataset.",
        };
      }
      const project = await projects().tryGetById(projectId);
      if (!project) {
        return { ok: false, status: 403, error: "Project not found" };
      }
      return { ok: true, projectId, teamId: project.teamId };
    }

    // 2. API key / legacy key / PAT (parity with the rest of the surface).
    // The SAME resolution and the SAME ceiling the framework chain applies,
    // including the fire-and-forget `lastUsedAt` stamp, which is what keeps
    // this door's answer to "whose key is this" identical to every other's.
    const resolved = await credentials.authenticate({ request: c.req.raw, permission: PERMISSION });
    if (!resolved.ok) {
      // The port answers 401 for an absent or unreadable credential and 403
      // for a ceiling denial; both statuses are already this contract's.
      return {
        ok: false,
        status: resolved.status === 403 ? 403 : 401,
        error: readRefusalSentence(resolved.body),
        body: resolved.body,
      };
    }
    if (resolved.project.id !== projectId) {
      return { ok: false, status: 401, error: "Invalid credentials" };
    }
    resolved.markUsed();

    return { ok: true, projectId, teamId: resolved.project.teamId };
  };
}

/**
 * The sentence inside a refusal body, for the `error` field this contract
 * carries beside it.
 *
 * Read rather than restated: the bodies are the wire the retired routes
 * published, so inventing a second sentence here would make the two fields of
 * one refusal disagree.
 */
function readRefusalSentence(body: object): string {
  const message = (body as { message?: unknown; error?: unknown }).message;
  if (typeof message === "string") return message;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" ? error : "Invalid credentials";
}
