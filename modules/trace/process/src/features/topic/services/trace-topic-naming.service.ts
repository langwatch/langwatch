/**
 * Puts friendly topic names on a categorical facet's values. The `value` stays the topic id the
 * filter uses; only the label changes, so a renamed topic reads correctly without invalidating a
 * cached facet's identity.
 */

import { type Authorization, projectIdsReadBy } from "@langwatch/authorization";
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
   * The `value` field stays as the ID (used for filtering); `label` carries the name. On an
   * aggregate the ids belong to any member the proof reads, so every one of them is asked.
   */
  async enrichTopicNames(
    authorization: Authorization,
    result: CategoricalFacetResult,
  ): Promise<CategoricalFacetResult> {
    const ids = result.values.map((v) => v.value).filter(Boolean);
    if (ids.length === 0) {
      return result;
    }

    // ponytail: one read per project; widen findNamesByIds to projectIds if aggregates grow large
    const perProject = await Promise.all(
      projectIdsReadBy(authorization).map((projectId) =>
        this.topicNames.findNamesByIds({ projectId, ids }),
      ),
    );
    const names = new Map(perProject.flatMap((found) => [...found]));

    return {
      ...result,
      values: result.values.map((v) => {
        const name = names.get(v.value);

        return name ? { ...v, label: name } : v;
      }),
    };
  }
}
