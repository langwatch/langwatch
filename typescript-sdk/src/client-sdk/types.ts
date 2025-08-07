import { type LangwatchApiClient } from '../internal/api/client';
import { type CacheStore } from './cache';
import { type Logger } from '../logger';
import { DataCaptureOptions } from '@/observability-sdk';

export interface InternalConfig {
  langwatchApiClient: LangwatchApiClient;
  cacheStore: CacheStore;
  logger: Logger;

  prompts: {
    defaultCacheTtlMs: number;
  };
  traces: {},

  observability: {
    dataCapture: DataCaptureOptions;
  };
}

export interface BaseRequestOptions {
  apiKey?: string;
  endpoint?: string;
  ignoreTracing?: boolean;
}
