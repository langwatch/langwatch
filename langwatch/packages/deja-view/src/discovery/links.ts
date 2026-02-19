import type {
  AggregateType,
} from "../../../../src/server/event-sourcing";

/**
 * Represents an inferred child link (inverse of a parent link).
 */
export interface DiscoveredChildLink {
  /** The aggregate type that has children */
  fromAggregateType: AggregateType;
  /** The child aggregate type */
  toAggregateType: AggregateType;
}

/**
 * Combined link information for an aggregate type.
 */
export interface AggregateLinkInfo {
  aggregateType: AggregateType;
  childLinks: DiscoveredChildLink[];
}

/**
 * Discovers aggregate links by importing pipelines.
 *
 * @example
 * const links = await discoverLinks();
 * // Returns map of aggregate type -> link info
 */
export async function discoverLinks(): Promise<
  Map<AggregateType, AggregateLinkInfo>
> {
  const linkMap = new Map<AggregateType, AggregateLinkInfo>();

  // Import pipelines dynamically
  const { discoverPipelines } = await import("./pipelines");
  const pipelines = await discoverPipelines();

  // Initialize link info for each pipeline's aggregate type
  for (const pipeline of pipelines) {
    if (!linkMap.has(pipeline.aggregateType)) {
      linkMap.set(pipeline.aggregateType, {
        aggregateType: pipeline.aggregateType,
        childLinks: [],
      });
    }
  }

  return linkMap;
}

/**
 * Gets link info for a specific aggregate type.
 */
export async function getLinksForAggregate(
  aggregateType: AggregateType,
): Promise<AggregateLinkInfo | undefined> {
  const allLinks = await discoverLinks();
  return allLinks.get(aggregateType);
}
