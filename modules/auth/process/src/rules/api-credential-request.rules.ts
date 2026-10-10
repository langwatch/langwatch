/**
 * What a credential door reads off a request before it asks anyone: the token
 * and project a key presents, and the refusal of a door asked no permission.
 * @see modules/auth/specs/api-rest-credentials.feature
 */

import type { AuthzPermission } from "@langwatch/authorization";

/** A door asked no permission is a mis-wired route: refused, never admitted. */
export function asked(permissions: readonly AuthzPermission[]): readonly AuthzPermission[] {
  if (permissions.length === 0) throw new Error("A credential door was asked no permission");

  return permissions;
}

export type ApiKeyRequestCredentials = Readonly<{
  token: string;
  projectId: string | null;
}>;

export function extractApiKeyRequestCredentials(request: Request): ApiKeyRequestCredentials | null {
  const authorization = request.headers.get("authorization");
  const xAuthToken = request.headers.get("x-auth-token");
  const xProjectId = request.headers.get("x-project-id");

  if (!xAuthToken && authorization?.toLowerCase().startsWith("basic ")) {
    const parsed = parseBasicCredentials(authorization.slice(6));
    if (parsed) {
      return parsed;
    }
  }

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) {
      return { token, projectId: xProjectId };
    }
  }

  return xAuthToken ? { token: xAuthToken, projectId: xProjectId } : null;
}

function parseBasicCredentials(value: string): ApiKeyRequestCredentials | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator < 1 || separator === decoded.length - 1) {
      return null;
    }
    return {
      projectId: decoded.slice(0, separator),
      token: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}
