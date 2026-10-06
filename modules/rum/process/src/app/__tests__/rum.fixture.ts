import { createApp, type ModuleSecretsScope } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";

import { rumProcessModule } from "../../rum.module.ts";

export const COLLECTOR_ENDPOINT = "http://collector.test:4318";
export const TELEMETRY_ENDPOINT = "http://telemetry-collector.test:4318";

/** rum's headers, from a chain over a fake environment, scoped as boot scopes them. */
function headerSecrets({
  collectorHeaders,
  telemetryHeaders,
}: Readonly<{
  collectorHeaders: string | undefined;
  telemetryHeaders: string | undefined;
}>): ModuleSecretsScope {
  const resolver = SecretsResolver.over(
    SecretsChain.start({
      environment: {
        RUM_COLLECTOR_HEADERS: collectorHeaders,
        OTEL_EXPORTER_OTLP_HEADERS: telemetryHeaders,
      },
    }).withEnv(),
  );
  return (owner, declared) => resolver.scopeTo(owner, declared);
}

/** The same chain production boots, over memory buckets. */
export function rumInstallation({
  collectorEndpoint,
  collectorHeaders,
  telemetryEndpoint,
  telemetryHeaders,
}: Readonly<{
  collectorEndpoint: string | undefined;
  collectorHeaders?: string;
  telemetryEndpoint?: string;
  telemetryHeaders?: string;
}>) {
  return createApp({ role: "api", secrets: headerSecrets({ collectorHeaders, telemetryHeaders }) })
    .withModules([rumProcessModule])
    .withStores(memoryStores())
    .withConfig({
      rum: { enabled: false, sampleRatio: 1, collectorEndpoint, telemetryEndpoint },
    });
}

export const exportWith = (spanCount: number) =>
  JSON.stringify({
    resourceSpans: [{ scopeSpans: [{ spans: Array.from({ length: spanCount }, () => ({})) }] }],
  });
