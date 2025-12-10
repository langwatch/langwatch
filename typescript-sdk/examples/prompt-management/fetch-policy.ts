/**
 * Fetch policy examples.
 *
 * Note: Local imports are used to avoid conflicts with internal caching
 * and file management.
 */

import type { CliRunner } from "../../__tests__/e2e/cli/helpers/cli-runner";

/**
 * Demonstrates the default (materialized-first) fetch policy.
 * Assumes the prompt already exists (locally and/or remotely).
 */
export const runDefaultFetchPolicy = async (handle: string) => {
  const { FetchPolicy, LangWatch } = await import("../../dist");

  const langwatch = new LangWatch();
  return langwatch.prompts.get(handle);
};

/**
 * Demonstrates ALWAYS_FETCH (API first, happy path).
 * Assumes the prompt already exists remotely.
 */
export const runAlwaysFetchPolicy = async (handle: string) => {
  const { FetchPolicy, LangWatch } = await import("../../dist");

  const langwatch = new LangWatch();
  return langwatch.prompts.get(handle, {
    fetchPolicy: FetchPolicy.ALWAYS_FETCH,
  });
};

/**
 * Demonstrates MATERIALIZED_ONLY with a local prompt file present.
 * Requires the Langwatch CLI for local prompt management.
 */
export const runMaterializedOnlyPolicy = async (handle: string, cli?: CliRunner) => {
  const { LangWatch, FetchPolicy } = await import("../../dist");

  // Add the prompt to the local filesystem from the
  cli.run(`prompt add ${handle}`);
  // Sync the prompt to the local filesystem
  cli.run(`prompt sync`);

  const langwatch = new LangWatch();
  return langwatch.prompts.get(handle, {
    fetchPolicy: FetchPolicy.MATERIALIZED_ONLY,
  });
};

/**
 * Demonstrates CACHE_TTL happy path (first fetch hits API).
 * Assumes the prompt already exists remotely.
 */
export const runCacheTtlPolicy = async (
  handle: string,
  cacheTtlMinutes = 5,
) => {
  const { LangWatch, FetchPolicy } = await import("../../dist");

  const langwatch = new LangWatch();
  return langwatch.prompts.get(handle, {
    fetchPolicy: FetchPolicy.CACHE_TTL,
    cacheTtlMinutes,
  });
};
