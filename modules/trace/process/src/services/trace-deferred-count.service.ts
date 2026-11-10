/**
 * Counts for deferred facets read without a filter, over the snapped discovery
 * window. One count runs per window and key set at a time, and is kept a minute.
 */

import type { FacetDescriptor } from "@langwatch/trace-contract";

import {
  discoverCacheKey,
  snapToWindowPreset,
  type DiscoverParams,
} from "../rules/trace-list-cache-key.rules.ts";
import { TraceTtlCacheService } from "./trace-ttl-cache.service.ts";

const DEFERRED_COUNT_TTL_MS = 60 * 1000;

type CountFacets = (input: {
  params: DiscoverParams;
  facetKeys: readonly string[];
}) => Promise<FacetDescriptor[]>;

export class TraceDeferredCountService {
  private readonly count: CountFacets;
  private readonly running = new Map<string, Promise<FacetDescriptor[]>>();
  private readonly counts = TraceTtlCacheService.create<FacetDescriptor[]>(DEFERRED_COUNT_TTL_MS);

  private constructor(count: CountFacets) {
    this.count = count;
  }

  static create({ count }: { count: CountFacets }): TraceDeferredCountService {
    return new TraceDeferredCountService(count);
  }

  /** A count missing one of the asked keys is returned but not kept. */
  get({
    params,
    facetKeys,
  }: {
    params: DiscoverParams;
    facetKeys: readonly string[];
  }): Promise<FacetDescriptor[]> {
    const snapped = snapToWindowPreset(params.timeRange);
    const key = JSON.stringify([
      discoverCacheKey({ authorization: params.authorization, snapped }),
      facetKeys,
    ]);
    const inFlight = this.running.get(key);
    if (inFlight) return inFlight;

    const run = this.countOnce({
      params: { authorization: params.authorization, timeRange: snapped },
      facetKeys,
      key,
    }).finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }

  private async countOnce({
    params,
    facetKeys,
    key,
  }: {
    params: DiscoverParams;
    facetKeys: readonly string[];
    key: string;
  }): Promise<FacetDescriptor[]> {
    const lookup = await this.counts.get(key);
    if (lookup.kind === "hit") return lookup.value;

    const counted = await this.count({ params, facetKeys });
    if (facetKeys.every((facetKey) => counted.some((facet) => facet.key === facetKey))) {
      await this.counts.set(key, counted);
    }
    return counted;
  }
}
