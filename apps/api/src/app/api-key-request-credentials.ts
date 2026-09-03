export type ApiKeyRequestCredentials = Readonly<{
  token: string;
  projectId: string | null;
}>;

/**
 * Preserves the credential precedence published by the existing API-key
 * transports: valid Basic, then non-empty Bearer, then X-Auth-Token.
 */
export function extractApiKeyRequestCredentials(request: Request): ApiKeyRequestCredentials | null {
  const authorization = request.headers.get("authorization");
  const xAuthToken = request.headers.get("x-auth-token");
  const xProjectId = request.headers.get("x-project-id");

  if (authorization?.toLowerCase().startsWith("basic ")) {
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
