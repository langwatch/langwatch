import { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { SpanProcessingExcludeRule } from "./observability";
import { Attributes } from "@opentelemetry/api";

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
   * Whether to skip the automatic setup of the OpenTelemetry SDK. If this is set, then
   * the LangWatch SDK will not attempt to setup the OpenTelemetry SDK. You will need to
   * setup the OpenTelemetry yourself, and ensure that a SpanProcessor is added to the
   * OpenTelemetry SDK that will send traces to the LangWatch API.
   */
  skipOpenTelemetrySetup?: boolean;

  /**
   * Whether to disable the automatic capture of input.
   */
  disableAutomaticInputCapture?: boolean;

  /**
   * Whether to disable the automatic capture of output.
   */
  disableAutomaticOutputCapture?: boolean;

  /**
   * The base attributes to use for the OpenTelemetry SDK.
   */
  baseAttributes?: Attributes;
}

interface InternalConfig {
  apiKey: string;
  endpoint: string;
  setupCalled: boolean;
  skipOpenTelemetrySetup: boolean;
  disableAutomaticInputCapture: boolean;
  disableAutomaticOutputCapture: boolean;

  baseAttributes: Attributes;
}

const config: InternalConfig = {
  apiKey: process.env.LANGWATCH_API_KEY ?? "",
  endpoint: process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai",
  setupCalled: false,
  skipOpenTelemetrySetup: false,
  disableAutomaticInputCapture: false,
  disableAutomaticOutputCapture: false,
  baseAttributes: {},
};

export function setConfig(options: SetupOptions) {
  config.setupCalled = true;

  config.apiKey = options.apiKey !== void 0
    ? options.apiKey
    : (process.env.LANGWATCH_API_KEY ?? config.apiKey);

  config.endpoint = options.endpoint !== void 0
    ? options.endpoint
    : (process.env.LANGWATCH_ENDPOINT ?? config.endpoint);

  if (config.apiKey === "") {
    console.warn("[langwatch setup] No API key provided. Please set the LANGWATCH_API_KEY environment variable or pass it to the setup function. The SDK will perform no operations.");
  }

  config.skipOpenTelemetrySetup = options.skipOpenTelemetrySetup ?? config.skipOpenTelemetrySetup;
  config.disableAutomaticInputCapture = options.disableAutomaticInputCapture ?? config.disableAutomaticInputCapture;
  config.disableAutomaticOutputCapture = options.disableAutomaticOutputCapture ?? config.disableAutomaticOutputCapture;

  config.baseAttributes = options.baseAttributes ?? config.baseAttributes;
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

export function isSetupCalled(): boolean {
  return config.setupCalled;
}
