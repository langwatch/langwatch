/**
 * OTLP HTTP exporter configuration without ambient environment variable
 * pollution: defaults + caller's URL and headers, applied cleanly.
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
