/**
 * The agent-config write-back of a dev tunnel session: pointing the agent at
 * the tunnel for the session, and restoring it on exit. Pure functions over
 * the untyped agent config JSON.
 */

/**
 * The per-session auth header the local proxy requires on every tunneled
 * request. Written onto the agent config for the session and removed on exit,
 * so a public quick-tunnel URL is never an open relay to the local agent.
 */
export const DEV_SECRET_HEADER = "X-LangWatch-Dev-Secret";

interface HeaderRow {
  key: string;
  value: string;
}

/** Reads `config.headers` defensively; the config is untyped JSON here. */
function readHeaderRows(config: Record<string, unknown>): HeaderRow[] {
  if (!Array.isArray(config.headers)) return [];
  return config.headers.filter(
    (row): row is HeaderRow =>
      !!row &&
      typeof row === "object" &&
      typeof (row as HeaderRow).key === "string" &&
      typeof (row as HeaderRow).value === "string",
  );
}

function withoutDevSecretHeader(rows: HeaderRow[]): HeaderRow[] {
  return rows.filter((row) => row.key.toLowerCase() !== DEV_SECRET_HEADER.toLowerCase());
}

/**
 * The written URL keeps the previous URL's request path on the tunnel host:
 * the platform posts to the agent URL verbatim, so a bare tunnel URL would
 * land every request on `/` instead of the path the local server serves.
 */
function tunnelUrlWithPreviousPath({
  tunnelUrl,
  previousUrl,
}: {
  tunnelUrl: string;
  previousUrl?: string;
}): string {
  if (!previousUrl) return tunnelUrl;
  try {
    const previous = new URL(previousUrl);
    const path = `${previous.pathname}${previous.search}`;
    if (path === "/" || path === "") return tunnelUrl;
    return `${tunnelUrl.replace(/\/+$/, "")}${path}`;
  } catch {
    return tunnelUrl;
  }
}

/**
 * The write-back: config with `url` REPLACED by the tunnel URL carrying the
 * previous URL's path, and the previous URL stashed under `devTunnel` so exit
 * can restore it. Replace, never append. When a crashed session left a
 * `devTunnel` behind, the original `previousUrl` is kept: the current `url`
 * is a dead tunnel, and restoring to it would restore nothing.
 *
 * With `secret` set, the dev-secret header row is written too, replacing any
 * existing row with that key, never appending a duplicate. Without a secret
 * (`--no-auth`), any stale dev-secret row is removed.
 */
export function applyDevTunnel({
  config,
  tunnelUrl,
  secret,
  connectedAt = new Date().toISOString(),
}: {
  config: Record<string, unknown>;
  tunnelUrl: string;
  secret?: string;
  connectedAt?: string;
}): Record<string, unknown> {
  const existingStash = config.devTunnel as { previousUrl?: string } | undefined;
  const previousUrl =
    existingStash?.previousUrl ??
    (typeof config.url === "string" ? config.url : undefined);

  const headers = withoutDevSecretHeader(readHeaderRows(config));
  if (secret) headers.push({ key: DEV_SECRET_HEADER, value: secret });

  return {
    ...config,
    url: tunnelUrlWithPreviousPath({ tunnelUrl, previousUrl }),
    headers,
    devTunnel: {
      ...(previousUrl !== undefined ? { previousUrl } : {}),
      connectedAt,
    },
  };
}

/**
 * The restore: config with the previous URL back in place, the `devTunnel`
 * stash dropped, and the dev-secret header row removed. Returns null when the
 * config carries no `devTunnel`, meaning nothing to restore, so the caller can skip
 * the PATCH entirely (idempotence: a second restore is a no-op).
 */
export function restoreDevTunnel({
  config,
}: {
  config: Record<string, unknown>;
}): Record<string, unknown> | null {
  const stash = config.devTunnel as { previousUrl?: string } | undefined;
  if (!stash || typeof config.devTunnel !== "object") return null;

  const restored: Record<string, unknown> = {
    ...config,
    headers: withoutDevSecretHeader(readHeaderRows(config)),
  };
  delete restored.devTunnel;
  if (typeof stash.previousUrl === "string" && stash.previousUrl.length > 0) {
    restored.url = stash.previousUrl;
  }
  return restored;
}

/**
 * The project simulations page, derived from the agent's `platformUrl`
 * (`https://…/<project-slug>/agents?…`): same origin, same project slug,
 * `/simulations` path.
 */
export function deriveSimulationsUrl(
  platformUrl: string | undefined,
): string | undefined {
  if (!platformUrl) return undefined;
  try {
    const parsed = new URL(platformUrl);
    const slug = parsed.pathname.split("/").find(Boolean);
    if (!slug) return undefined;
    return `${parsed.origin}/${slug}/simulations`;
  } catch {
    return undefined;
  }
}
