import type { OtlpIngestCredentialInput } from "@langwatch/trace-contract";

/** A token read off a request, and the project it named where one was given. */
export type TraceLegacyRequestCredentials = Readonly<{
  token: string;
  projectId: string | null;
}>;

/**
 * Preserves the credential precedence this deployment publishes across every
 * REST family: valid Basic, then non-empty Bearer, then `X-Auth-Token`.
 */
export function extractTraceLegacyRequestCredentials(
  request: Request,
): TraceLegacyRequestCredentials | null {
  return extractTraceIngestCredentials({
    authorization: request.headers.get("authorization"),
    xAuthToken: request.headers.get("x-auth-token"),
    xProjectId: request.headers.get("x-project-id"),
  });
}

/** The portable credential facts both the OTLP route and collector resolve. */
export function extractTraceIngestCredentials(
  input: OtlpIngestCredentialInput,
): TraceLegacyRequestCredentials | null {
  const { authorization, xAuthToken, xProjectId } = input;

  if (authorization?.toLowerCase().startsWith("basic ")) {
    const parsed = parseBasicCredentials(authorization.slice(6));
    if (parsed) return parsed;
  }

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return { token, projectId: xProjectId };
  }

  return xAuthToken ? { token: xAuthToken, projectId: xProjectId } : null;
}

function parseBasicCredentials(value: string): TraceLegacyRequestCredentials | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator < 1 || separator === decoded.length - 1) return null;
    return { projectId: decoded.slice(0, separator), token: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}
