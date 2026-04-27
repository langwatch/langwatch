/**
 * Elasticsearch sync for annotation count metadata on traces.
 *
 * TEMPORARY: This module exists only for backward compatibility with
 * Elasticsearch-based trace queries. Once the ClickHouse migration is
 * complete and ES is fully decommissioned, delete this entire file.
 */

import {
  esClient,
  TRACE_COLD_INDEX,
  TRACE_INDEX,
  traceIndexId,
} from "~/server/elasticsearch";

/**
 * Synchronises annotation metadata to Elasticsearch trace documents.
 *
 * TEMPORARY: Remove this class (and this file) once ES is fully decommissioned.
 */
export class AnnotationEsSync {
  /**
   * Increments the annotation count on a trace document after a new annotation
   * is created.
   */
  async syncAfterCreate(traceId: string, projectId: string): Promise<void> {
    const updateScript = `
      try {
        if (!ctx._source.containsKey('annotations')) {
          ctx._source.annotations = [
            'count': 1,
            'hasAnnotation': true
          ];
        } else if (ctx._source.annotations.containsKey('count')) {
          ctx._source.annotations.count += 1;
        } else {
          ctx._source.annotations.count = 1;
        }
        ctx._source.annotations.hasAnnotation = true;
      } catch (Exception e) {
        // If anything goes wrong, ensure we have a valid annotations object
        ctx._source.annotations = [
          'count': 1,
          'hasAnnotation': true
        ];
      }
    `;

    await this.updateTraceInElasticsearch(traceId, projectId, updateScript);
  }

  /**
   * Decrements the annotation count on a trace document after an annotation
   * is deleted. Removes the annotations object entirely when the count reaches zero.
   */
  async syncAfterDelete(traceId: string, projectId: string): Promise<void> {
    const updateScript = `
      try {
        if (ctx._source.containsKey('annotations') && ctx._source.annotations.containsKey('count')) {
          ctx._source.annotations.count -= 1;
          if (ctx._source.annotations.count <= 0) {
            ctx._source.remove('annotations');
          } else {
            ctx._source.annotations.hasAnnotation = true;
          }
        }
      } catch (Exception e) {
        // If anything goes wrong, remove the annotations object
        ctx._source.remove('annotations');
      }
    `;

    await this.updateTraceInElasticsearch(traceId, projectId, updateScript);
  }

  /**
   * Updates a trace document in Elasticsearch with a painless script.
   * Tries the hot index alias first, then falls back to the cold index.
   */
  private async updateTraceInElasticsearch(
    traceId: string,
    projectId: string,
    updateScript: string,
  ): Promise<void> {
    const client = await esClient({ projectId });
    let currentColdIndex: string | undefined;
    try {
      currentColdIndex = Object.keys(
        await client.indices.getAlias({
          name: TRACE_COLD_INDEX.alias,
        }),
      )[0];
    } catch (error) {
      if (
        error instanceof Error &&
        ((error.message.includes("alias") &&
          error.message.includes("missing")) ||
          (error as any).meta?.body?.error?.includes("missing"))
      ) {
        // no cold index found, that's fine
      } else {
        throw error;
      }
    }

    const traceIndexIdValue = traceIndexId({
      traceId,
      projectId,
    });

    // Try alias first
    try {
      await client.update({
        index: TRACE_INDEX.alias,
        id: traceIndexIdValue,
        retry_on_conflict: 10,
        body: {
          script: {
            source: updateScript,
            lang: "painless",
          },
        },
      });
    } catch (error) {
      // If alias fails, try cold index
      if (currentColdIndex) {
        await client.update({
          index: currentColdIndex,
          id: traceIndexIdValue,
          retry_on_conflict: 10,
          body: {
            script: {
              source: updateScript,
              lang: "painless",
            },
          },
        });
      } else {
        // Re-throw the original error if no cold index available
        throw error;
      }
    }
  }
}
