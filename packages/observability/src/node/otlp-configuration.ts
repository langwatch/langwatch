/**
 * The OTLP HTTP exporter configuration a process builds for itself.
 *
 * Every public OTLP exporter constructor merges the ambient
 * `OTEL_EXPORTER_OTLP_*_HEADERS` into whatever headers the caller supplied.
 * A process that parsed its configuration once, from one source, would then
 * ship a header nobody in this repository put there — which is how a
 * deployment's telemetry quietly acquires a second destination's credential.
 *
 * So the delegate is configured here instead: the exporter defaults, then the
 * caller's URL and headers, then the content type applied last exactly as the
 * exporter's own converter would. The result is a complete projection of the
 * process's configuration and nothing else.
 *
 * The defaults and the agent factory arrive as functions rather than as an
 * imported pair, and their types travel with them, so this module states the
 * policy without naming an exporter package — and the exporter's own
 * configuration type still checks the result at the call site.
 */
export function createAuthoritativeOtlpConfiguration<TDefaults, TAgentFactory>({
  url,
  headers,
  contentType,
  getDefaults,
  agentFactoryFromOptions,
}: {
  url: string;
  headers: Readonly<Record<string, string>>;
  contentType: string;
  getDefaults: () => TDefaults;
  agentFactoryFromOptions: (options: { keepAlive: boolean }) => TAgentFactory;
}): TDefaults & {
  url: string;
  headers: () => Promise<Record<string, string>>;
  agentFactory: TAgentFactory;
} {
  return {
    ...getDefaults(),
    url,
    headers: async () => ({
      ...headers,
      "Content-Type": contentType,
    }),
    agentFactory: agentFactoryFromOptions({ keepAlive: true }),
  };
}
