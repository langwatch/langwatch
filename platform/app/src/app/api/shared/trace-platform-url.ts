import { platformUrl } from "./platform-url";

const hasHint = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * The path of a trace's short link. When the trace's start time is known it
 * rides along as `t`, which the drawer reads as the partition hint: without
 * it, every per-trace read scans by id across every partition, and a link
 * from an API response, a Slack message or an email opens onto a skeleton
 * for seconds instead of milliseconds.
 */
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

/** The full platform URL of a trace, with the partition hint when the start time is known. */
export function tracePlatformUrl({
  projectSlug,
  traceId,
  occurredAtMs,
}: {
  projectSlug: string;
  traceId: string;
  occurredAtMs?: number | null;
}): string {
  return platformUrl({
    projectSlug,
    path: tracePath({ traceId, occurredAtMs }),
  });
}
