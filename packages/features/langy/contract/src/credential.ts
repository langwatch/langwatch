import type { LangyCredentialSession, LangyMirrorTier, LangyWorkerCredentials } from "./langy";

export function resolveLangyMirrorTier(
  { projectId }: { projectId: string },
  env: Record<string, string | undefined> = {},
): LangyMirrorTier {
  const mirrorProjectId = env.LANGY_MIRROR_PROJECT_ID?.trim();
  return mirrorProjectId === projectId ? "skip" : "content";
}

export function resolveWorkerCallbackUrl(
  env: Record<string, string | undefined> = {},
): string | undefined {
  return env.LANGY_WORKER_CALLBACK_URL ?? env.LANGWATCH_ENDPOINT ?? env.LANGWATCH_API_URL;
}

export function resolveWorkerGatewayBaseUrl(
  env: Record<string, string | undefined> = {},
): string | undefined {
  return env.LANGY_WORKER_GATEWAY_URL ?? env.LW_GATEWAY_PUBLIC_URL ?? env.LW_GATEWAY_BASE_URL;
}

export function ensureGatewayV1BaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function resolveActingGithubLogin(session: LangyCredentialSession): string {
  const raw = session.user.name ?? session.user.email?.split("@")[0] ?? "";
  const handle = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);
  return handle || "langwatch-user";
}

export function stripGithubCredentials(credentials: LangyWorkerCredentials): void {
  delete credentials.githubToken;
  delete credentials.githubLogin;
}
