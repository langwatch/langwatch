import { MICROSOFT_LEGACY_CALLBACK_ID } from "@ee/sso/providers";

/**
 * The Microsoft callback, served at the path Azure app registrations carry.
 *
 * better-auth mounts the Microsoft provider as `microsoft`, so its callback
 * route answers `/api/auth/callback/microsoft`. The provider sends
 * `/api/auth/callback/azure-ad` as its redirect URI (`providers.ts`), the
 * path registered with Azure before 3.17 and documented since, so a request
 * arriving there is handed to better-auth under the provider's own path.
 * Every other request passes through untouched.
 */
const LEGACY_PATH = `/api/auth/callback/${MICROSOFT_LEGACY_CALLBACK_ID}`;
const PROVIDER_PATH = "/api/auth/callback/microsoft";

/** Serves a request to the legacy `/api/auth/callback/azure-ad` path as the
 *  Microsoft provider's callback, and returns any other request unchanged. */
export function aliasLegacyMicrosoftCallback(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname !== LEGACY_PATH) return request;
  url.pathname = PROVIDER_PATH;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
    ...(hasBody ? { body: request.body, duplex: "half" } : {}),
  } as RequestInit);
}
