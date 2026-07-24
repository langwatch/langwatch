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
 *      `hasProjectPermission`.
 *   2. Project API key / legacy key / PAT (parity with the rest of the surface)
 *      — resolved via `TokenResolver` + `enforceApiKeyCeiling`.
 *
 * `projectId` comes from the request (the route reads it from the body/param
 * and passes it in) since there is no `authMiddleware` to set `c.get("project")`.
 */

import type { Project } from "@prisma/client";
import type { Context } from "hono";
import { hasProjectPermission } from "~/server/api/rbac";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";

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
  | { ok: false; status: 401 | 403; error: string };

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
  const session = await getServerAuthSession({ req: c.req.raw as any });
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
    const permitted = await hasProjectPermission(
      { prisma, session },
      projectId,
      PERMISSION,
    );
    if (!permitted) {
      return {
        ok: false,
        status: 403,
        error: "You do not have permission to upload to this dataset.",
      };
    }
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
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

  const resolver = TokenResolver.create(prisma);
  const resolved = await resolver.resolve({
    token: credentials.token,
    projectId: credentials.projectId ?? projectId,
  });
  if (!resolved || resolved.project.id !== projectId) {
    return { ok: false, status: 401, error: "Invalid credentials" };
  }

  try {
    await enforceApiKeyCeiling({ prisma, resolved, permission: PERMISSION });
  } catch (error) {
    const denial = apiKeyCeilingDenialResponse(error);
    return { ok: false, status: denial.status, error: denial.message };
  }

  // Telemetry parity with the rest of the API-key surface: fire-and-forget
  // bump of `lastUsedAt` on a successful API-key auth (no-op for legacy keys,
  // which carry no `apiKeyId`). Matches the experiments-v3 `markUsed` pattern.
  if (resolved.type === "apiKey") {
    resolver.markUsed({ apiKeyId: resolved.apiKeyId });
  }

  return {
    ok: true,
    projectId,
    teamId: (resolved.project as Project).teamId,
  };
}
