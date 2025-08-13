import { version } from "../../package.json";
import { getRuntime } from "./runtime";

export const LANGWATCH_SDK_RUNTIME = getRuntime;

export const LANGWATCH_SDK_NAME_OBSERVABILITY = "langwatch-observability-sdk";
export const LANGWATCH_SDK_NAME_CLIENT = "langwatch-client-sdk";
export const LANGWATCH_SDK_LANGUAGE = "typescript";
export const LANGWATCH_SDK_VERSION = version;

export const DEFAULT_ENDPOINT = "https://app.langwatch.ai/";
export const DEFAULT_SERVICE_NAME = "unknown-service.langwatch";

export const TRACES_PATH = "/api/otel/v1/traces";
export const LOGS_PATH = "/api/otel/v1/logs";
export const METRICS_PATH = "/api/otel/v1/metrics";
