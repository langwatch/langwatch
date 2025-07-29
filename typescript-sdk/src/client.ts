import { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { SpanProcessingExcludeRule } from "./observability";

export interface SetupOptions {
  /**
   * The API key to use for the LangWatch API.
   */
  apiKey?: string;

  /**
   * The endpoint to use for the LangWatch API.
   */
  endpoint?: string;

  /**
   * The span processors to use for the OpenTelemetry SDK.
   *
   * If provided, these will be added to the OpenTelemetry SDK after the LangWatch SDK has
   * been initialized.
   */
  otelSpanProcessors?: SpanProcessor[];

  /**
   * The span processing exclude rules to use for the OpenTelemetry SDK.
   *
   * If provided, these will be added to the OpenTelemetry SDK after the LangWatch SDK has
   * been initialized.
   *
   * If you are using the `otelSpanProcessors` option, then these will be ignored.
   */
  otelSpanProcessingExcludeRules?: SpanProcessingExcludeRule[];

  /**
   * Whether to disable the automatic setup of the OpenTelemetry SDK. If this is set, then
   * the LangWatch SDK will not attempt to setup the OpenTelemetry SDK. You will need to
   * setup the OpenTelemetry SDK yourself, and ensure that a SpanProcessor is added to the
   * OpenTelemetry SDK that will send traces to the LangWatch API.
   */
  disableOpenTelemetryAutomaticSetup?: boolean;

  /**
   * Whether to disable the automatic capture of input.
   */
  disableAutomaticInputCapture?: boolean;
  disableAutomaticOutputCapture?: boolean;
}

interface InternalConfig {
  apiKey: string;
  endpoint: string;
  disableOpenTelemetryAutomaticSetup: boolean;
  disableAutomaticInputCapture: boolean;
  disableAutomaticOutputCapture: boolean;
}

const config: InternalConfig = {
  apiKey: process.env.LANGWATCH_API_KEY ?? "",
  endpoint: process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai",
  disableOpenTelemetryAutomaticSetup: false,
  disableAutomaticInputCapture: false,
  disableAutomaticOutputCapture: false,
};

export function setConfig(options: SetupOptions) {
  config.apiKey = options.apiKey !== void 0
    ? options.apiKey
    : (process.env.LANGWATCH_API_KEY ?? config.apiKey);

  config.endpoint = options.endpoint !== void 0
    ? options.endpoint
    : (process.env.LANGWATCH_ENDPOINT ?? config.endpoint);

  config.disableOpenTelemetryAutomaticSetup = options.disableOpenTelemetryAutomaticSetup ?? config.disableOpenTelemetryAutomaticSetup;
  config.disableAutomaticInputCapture = options.disableAutomaticInputCapture ?? config.disableAutomaticInputCapture;
  config.disableAutomaticOutputCapture = options.disableAutomaticOutputCapture ?? config.disableAutomaticOutputCapture;
}

export function getApiKey(): string {
  return config.apiKey;
}

export function getEndpoint(): string {
  return config.endpoint;
}

export function canAutomaticallyCaptureInput(): boolean {
  return !config.disableAutomaticInputCapture;
}

export function canAutomaticallyCaptureOutput(): boolean {
  return !config.disableAutomaticOutputCapture;
}
