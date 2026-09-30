/**
 * The version this install reports, to the license sync, the usage report
 * and the checkup alike.
 *
 * Deployments name it the way every other service on the box does, through
 * OpenTelemetry's resource attributes or `SERVICE_VERSION`. An install that
 * names none reports `unknown` rather than a number made up here.
 */
export function readInstallVersion(
  environment: Record<string, string | undefined> = process.env,
): string {
  const explicit = environment.SERVICE_VERSION?.trim();
  if (explicit) return explicit;

  for (const pair of (environment.OTEL_RESOURCE_ATTRIBUTES ?? "").split(",")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== "service.version") continue;
    const value = pair.slice(separator + 1).trim();
    if (value) return value;
  }

  return environment.npm_package_version?.trim() ?? "unknown";
}
