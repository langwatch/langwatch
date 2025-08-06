import { type LangwatchApiClient } from '../internal/api/client';
import { type CacheStore } from './cache';
import { type Logger } from '../logger';

export interface InternalConfig {
  langwatchApiClient: LangwatchApiClient;
  cacheStore: CacheStore;
  logger: Logger;

  prompts: {
    defaultCacheTtlMs: number;
  };
  traces: {},
}

export interface BaseRequestOptions {
  apiKey?: string;
  endpoint?: string;
  ignoreTracing?: boolean;
}
