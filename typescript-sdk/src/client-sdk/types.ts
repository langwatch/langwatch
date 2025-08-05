import { LangwatchApiClient } from '../internal/api/client';
import { type CacheStore } from './cache';

export interface InternalConfig {
  langwatchApiClient: LangwatchApiClient;
  cacheStore: CacheStore;
  prompts: {
    defaultCacheTtlMs: number;
  };
}

export interface BaseRequestOptions {
  apiKey?: string;
  endpoint?: string;
  ignoreTracing?: boolean;
}
