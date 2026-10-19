import type { LangyCredentialSession, LangyMirrorTier, LangyWorkerCredentials } from "./langy.ts";

export function resolveLangyMirrorTier(
  { projectId }: { projectId: string },
  env: Record<string, string | undefined> = {},
): LangyMirrorTier {
  const mirrorProjectId = env.LANGY_MIRROR_PROJECT_ID?.trim();
  return mirrorProjectId === projectId ? "skip" : "content";
}

export function ensureGatewayV1BaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
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
