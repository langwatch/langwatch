import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { version } from "../../../package.json";

export function createLangWatchExporter(apiKey: string, endpointURL: string) {
  return new OTLPTraceExporter({
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "X-LangWatch-SDK-Version": version,
      "X-LangWatch-SDK-Language": `typescript-${typeof process !== "undefined" ? "node" : "browser"}`,
      "X-LangWatch-SDK-Name": "langwatch-observability-sdk",
    },
    url: endpointURL,
  });
}
