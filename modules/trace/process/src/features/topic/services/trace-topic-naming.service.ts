/**
 * Puts friendly topic names on a categorical facet's values. The `value` stays the topic id the
 * filter uses; only the label changes, so a renamed topic reads correctly without invalidating a
 * cached facet's identity.
 */

import type { CategoricalFacetResult } from "@langwatch/trace-contract";

import type { TraceTopicNamesReadRepository } from "../repositories/trace-topic-names.repository.ts";

type TopicNames = Pick<TraceTopicNamesReadRepository, "findNamesByIds">;

export class TraceTopicNamingService {
  private constructor(private readonly topicNames: TopicNames) {}

  static create({ topicNames }: { topicNames: TopicNames }): TraceTopicNamingService {
    return new TraceTopicNamingService(topicNames);
  }

  /**
   * Replace TopicId/SubTopicId facet values with friendly names from topic's shared table.
   * The `value` field stays as the ID (used for filtering); `label` carries the name.
   */
  async enrichTopicNames(
    projectId: string,
    result: CategoricalFacetResult,
  ): Promise<CategoricalFacetResult> {
    const ids = result.values.map((v) => v.value).filter(Boolean);
    if (ids.length === 0) {
      return result;
    }

    const names = await this.topicNames.findNamesByIds({ projectId, ids });

    return {
      ...result,
      values: result.values.map((v) => {
        const name = names.get(v.value);

        return name ? { ...v, label: name } : v;
      }),
    };
  }
}
