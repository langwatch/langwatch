/**
 * One automation resource's platform address: `publicBaseUrl`, project
 * slug, and the caller's path -- mirrors `suite-platform-url.rules.ts`.
 * No request-scoped builder, so the app composes the link itself.
 */
export function automationPlatformUrl({
  publicBaseUrl,
  projectSlug,
  path,
}: {
  publicBaseUrl: string;
  projectSlug: string;
  path: string;
}): string {
  const base = publicBaseUrl.replace(/\/+$/, "");

  return `${base}/${projectSlug}${path}`;
}

const hasHint = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** A trace's short-link path; a known start time rides along as `t`, the partition hint. */
export function tracePath({
  traceId,
  occurredAtMs,
}: {
  traceId: string;
  occurredAtMs?: number | null;
}): string {
  const path = `/traces/${traceId}`;
  return hasHint(occurredAtMs) ? `${path}?t=${Math.floor(occurredAtMs)}` : path;
}
