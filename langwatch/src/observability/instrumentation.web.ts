import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { metrics } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader, MeterProvider } from "@opentelemetry/sdk-metrics";
import { ZoneContextManager } from "@opentelemetry/context-zone";

// Guard against SSR
if (typeof window !== "undefined") {
  const isProd = process.env.NODE_ENV === "production";

  // Traces
  const traceEndpoint = new URL("/api/otel-proxy/v1/traces", window.location.href).toString();
  const otlpTraceExporter = new OTLPTraceExporter({ url: traceEndpoint });
  const tracerProvider = new WebTracerProvider({
    spanProcessors: isProd
      ? [new BatchSpanProcessor(otlpTraceExporter)]
      : [
        new SimpleSpanProcessor(otlpTraceExporter),
        // new SimpleSpanProcessor(new ConsoleSpanExporter()),
      ],
    resource: resourceFromAttributes({
      "service.name": "langwatch-frontend",
      "deployment.environment": process.env.NEXT_PUBLIC_NODE_ENV ?? process.env.NODE_ENV,
    }),
  });

  tracerProvider.register({ contextManager: new ZoneContextManager() });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: [],
        // enabled: false,
        measureRequestSize: true,
        ignoreUrls: [
          /\/api/,
          /\/api\/otel-proxy\//,
          /\/_next\//,
          /\/__nextjs_/,
          /posthog\.com/,
          /pendo\.io/,
          /crisp.chat/,
          /reo.dev/,
        ],
      }),
      new XMLHttpRequestInstrumentation({
        // propagateTraceHeaderCorsUrls: /.*/,
        propagateTraceHeaderCorsUrls: [],
        measureRequestSize: true,
        // enabled: false,
        ignoreUrls: [
          /\/api/,
          /^\/api\/otel-proxy\//,
          /^\/_next\//,
          /\/__nextjs_/,
          /posthog\.com/,
          /pendo\.io/,
          /crisp.chat/,
          /reo.dev/,
        ],
      }),
    ],
  });

  // Metrics
  const metricEndpoint = new URL("/api/otel-proxy/v1/metrics", window.location.href).toString();
  const metricExporter = new OTLPMetricExporter({ url: metricEndpoint });
  const meterProvider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60000 })],
  });

  // Set global meter provider for metrics
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (metrics as any).setGlobalMeterProvider?.(meterProvider);
}
