export interface SetupOptions {
  apiKey?: string;
  endpoint?: string;
  disableOpenTelemetryAutomaticSetup?: boolean;
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
  config.apiKey = options.apiKey ?? config.apiKey;
  config.endpoint = options.endpoint ?? config.endpoint;
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

export function canCaptureInput(): boolean {
  return !config.disableAutomaticInputCapture;
}

export function canCaptureOutput(): boolean {
  return !config.disableAutomaticOutputCapture;
}
