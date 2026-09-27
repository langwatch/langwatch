import { createApp, type ModuleSecretsScope, withMemoryRepositories } from "@langwatch/kernel";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";

import { rumServer } from "../../rum.server.ts";

export const COLLECTOR_ENDPOINT = "http://collector.test:4318";
export const TELEMETRY_ENDPOINT = "http://telemetry-collector.test:4318";

/** rum's collector headers, from a chain over a fake environment, scoped as boot scopes them. */
function collectorSecrets(headers: string | undefined): ModuleSecretsScope {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { RUM_COLLECTOR_HEADERS: headers } }).withEnv(),
  );
  return (owner, declared) => resolver.scopeTo(owner, declared);
}

/** Observability's exporter as the process hands it down, headers applied inside a build. */
function telemetryExporter(
  endpoint: string | undefined,
  headers: Readonly<Record<string, string>>,
) {
  return {
    endpoint,
    withHeaders: <Out>(build: (applied: Readonly<Record<string, string>>) => Out): Out =>
      build(headers),
  };
}

/** The same chain production boots, over memory buckets. */
export function rumInstallation({
  collectorEndpoint,
  collectorHeaders,
  telemetryEndpoint,
  telemetryHeaders = {},
  logger = createTestLogger().logger,
}: Readonly<{
  collectorEndpoint: string | undefined;
  collectorHeaders?: string;
  telemetryEndpoint?: string;
  telemetryHeaders?: Readonly<Record<string, string>>;
  logger?: ReturnType<typeof createTestLogger>["logger"];
}>) {
  return createApp({ role: "api", secrets: collectorSecrets(collectorHeaders) })
    .withModules([withMemoryRepositories(rumServer)])
    .withConfig({ rum: { collectorEndpoint } })
    .withObservability((observability) => observability.withLogging(logger))
    .withMembers({ telemetryExporter: telemetryExporter(telemetryEndpoint, telemetryHeaders) });
}

export const exportWith = (spanCount: number) =>
  JSON.stringify({
    resourceSpans: [{ scopeSpans: [{ spans: Array.from({ length: spanCount }, () => ({})) }] }],
  });
