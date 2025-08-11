import { type LangwatchApiClient } from '../internal/api/client';
import { type Logger } from '../logger';

export interface InternalConfig {
  langwatchApiClient: LangwatchApiClient;
  logger: Logger;
}

export interface BaseRequestOptions {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  ignoreTracing?: boolean;
}
