import type {
  AggregateType,
  ParentLink,
} from "../../../../src/server/event-sourcing/library";
import type { Event } from "../lib/types";

/**
 * Represents a discovered parent link from a pipeline.
 */
export interface DiscoveredParentLink {
  /** The aggregate type that has this parent link */
  fromAggregateType: AggregateType;
  /** The parent aggregate type */
  toAggregateType: AggregateType;
  /** Function to extract the parent ID from an event */
  extractParentId: (event: Event) => string | null;
}

/**
 * Represents an inferred child link (inverse of a parent link).
 */
export interface DiscoveredChildLink {
  /** The aggregate type that has children */
  fromAggregateType: AggregateType;
  /** The child aggregate type */
  toAggregateType: AggregateType;
  /** The field in child events that references this aggregate */
  linkedVia: "parentLink";
}

/**
 * Combined link information for an aggregate type.
 */
export interface AggregateLinkInfo {
  aggregateType: AggregateType;
  parentLinks: DiscoveredParentLink[];
  childLinks: DiscoveredChildLink[];
}

/**
 * Discovers aggregate links by importing pipelines and extracting their parentLinks.
 * Also infers inverse (child) links automatically.
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
  const pipelines = await importPipelines();

  // Process parent links from each pipeline
  for (const pipeline of pipelines) {
    const { aggregateType, parentLinks } = pipeline;

    // Initialize link info for this aggregate type
    if (!linkMap.has(aggregateType)) {
      linkMap.set(aggregateType, {
        aggregateType,
        parentLinks: [],
        childLinks: [],
      });
    }

    const linkInfo = linkMap.get(aggregateType)!;

    // Add parent links
    for (const parentLink of parentLinks) {
      linkInfo.parentLinks.push({
        fromAggregateType: aggregateType,
        toAggregateType: parentLink.targetAggregateType,
        extractParentId: parentLink.extractParentId as (
          event: Event,
        ) => string | null,
      });

      // Create/update inverse (child) link on the parent aggregate type
      if (!linkMap.has(parentLink.targetAggregateType)) {
        linkMap.set(parentLink.targetAggregateType, {
          aggregateType: parentLink.targetAggregateType,
          parentLinks: [],
          childLinks: [],
        });
      }

      const parentLinkInfo = linkMap.get(parentLink.targetAggregateType)!;
      parentLinkInfo.childLinks.push({
        fromAggregateType: parentLink.targetAggregateType,
        toAggregateType: aggregateType,
        linkedVia: "parentLink",
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

/**
 * Imports all pipelines and extracts their link information.
 */
async function importPipelines(): Promise<
  Array<{
    aggregateType: AggregateType;
    parentLinks: ParentLink<any>[];
  }>
> {
  const { discoverPipelines } = await import("./pipelines");
  const pipelines = await discoverPipelines();
  return pipelines.map((p) => ({
    aggregateType: p.aggregateType,
    parentLinks: p.parentLinks as ParentLink<any>[],
  }));
}
