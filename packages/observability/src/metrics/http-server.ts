/**
 * Inbound HTTP request duration; every label is bounded, so no raw path becomes a series.
 * `service` is not a label: the `service.name` resource attribute carries it.
 */
import { histogram } from "./instruments.ts";

const requestDuration = histogram({
  name: "http_server_request_duration_seconds",
  description:
    "Inbound HTTP request latency by route template, method and status. Route is the matched template (/api/:apiVersion/traces/:id), never the raw path.",
});

const KNOWN_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/** Used when no route claimed the request: one series, never the raw path. */
export const UNMATCHED_ROUTE = "unmatched";

/** A method outside the standard set is one series, not an attacker-chosen label. */
export function normalizeHttpMethod(method: string): string {
  const upper = method.toUpperCase();
  return KNOWN_METHODS.has(upper) ? upper : "_OTHER";
}

/** `2xx`, `4xx`, `5xx`; anything outside 100-599 is `unknown`. */
export function statusClass(status: number): string {
  return status >= 100 && status <= 599 ? `${Math.floor(status / 100)}xx` : "unknown";
}

const templates = new WeakMap<Request, string>();

/**
 * Records the route template an inner router matched for `request`, so the
 * outer recorder can label by it. The innermost router writes last, and that
 * is the most specific template.
 */
export function noteRouteTemplate(request: Request, template: string): void {
  templates.set(request, template);
}

/** The template an inner router noted for `request`, if any. */
export function routeTemplateOf(request: Request): string | undefined {
  return templates.get(request);
}

export interface HttpServerRequest {
  readonly method: string;
  /** A bounded route label: a template or a mount prefix, never a raw path. */
  readonly route: string;
  readonly status: number;
  readonly durationSeconds: number;
}

export function recordHttpServerRequest({
  method,
  route,
  status,
  durationSeconds,
}: HttpServerRequest): void {
  requestDuration.observe(durationSeconds, {
    http_request_method: normalizeHttpMethod(method),
    http_route: route,
    http_response_status_code: String(status),
    status_class: statusClass(status),
  });
}
