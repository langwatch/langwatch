import { TRACE_INDEX, esClient, traceIndexId } from "../server/elasticsearch";
import { prisma } from "../server/db";
import { createLogger } from "../utils/logger";
import type { Annotation } from "@prisma/client";

const logger = createLogger("langwatch:tasks:syncAnnotations");

type ProjectAnnotations = Record<string, Record<string, Annotation[]>>;

/**
 * This task syncs the annotations from the database to the Elasticsearch index.
 * This is used to update older traces that don't have annotations in the index for version older than May 20th 2025.
 *
 * In this file dbMultiTenancyProtection.ts you will need to allow Annotation model to be accessed by all projects.
 */

export default async function execute() {
  const annotations = await prisma.annotation.findMany({});

  logger.info({ count: annotations.length }, "Found annotations to sync");

  // Group annotations by projectId and traceId
  const annotationsByProjectAndTrace = annotations.reduce<ProjectAnnotations>(
    (acc, annotation) => {
      if (!acc[annotation.projectId]) {
        acc[annotation.projectId] = {};
      }
      if (!acc[annotation.projectId]![annotation.traceId]) {
        acc[annotation.projectId]![annotation.traceId] = [];
      }
      acc[annotation.projectId]![annotation.traceId]!.push(annotation);
      return acc;
    },
    {}
  );

  let totalProcessedCount = 0;
  const totalProjects = Object.keys(annotationsByProjectAndTrace).length;

  // Process each project
  for (const [projectId, projectAnnotations] of Object.entries(
    annotationsByProjectAndTrace as Record<string, Record<string, Annotation[]>>
  )) {
    logger.info(
      { projectId, traceCount: Object.keys(projectAnnotations).length },
      "Processing project"
    );

    const client = await esClient({ projectId });
    let processedCount = 0;

    // Update each trace in Elasticsearch
    for (const [traceId, traceAnnotations] of Object.entries(
      projectAnnotations as Record<string, Annotation[]>
    )) {
      try {
        await client.update({
          index: TRACE_INDEX.alias,
          id: traceIndexId({
            traceId,
            projectId,
          }),
          retry_on_conflict: 10,
          body: {
            script: {
              source: `
                try {
                  if (!ctx._source.containsKey('annotations')) {
                    Map annotations = new HashMap();
                    annotations.put('count', params.count);
                    annotations.put('hasAnnotation', true);
                    ctx._source.annotations = annotations;
                  } else {
                    ctx._source.annotations.count = params.count;
                    ctx._source.annotations.hasAnnotation = true;
                  }
                } catch (Exception e) {
                  Map annotations = new HashMap();
                  annotations.put('count', params.count);
                  annotations.put('hasAnnotation', true);
                  ctx._source.annotations = annotations;
                }
              `,
              lang: "painless",
              params: {
                count: traceAnnotations.length,
              },
            },
            upsert: {
              annotations: {
                count: traceAnnotations.length,
                hasAnnotation: true,
              },
            },
          },
        });
        processedCount++;
        totalProcessedCount++;
        if (processedCount % 100 === 0) {
          logger.info(
            { projectId, processedCount },
            "Processed annotations for project"
          );
        }
      } catch (error) {
        logger.error(
          { error, projectId, traceId },
          "Failed to update annotations in Elasticsearch"
        );
      }
    }

    logger.info({ projectId, processedCount }, "Finished processing project");
  }

  logger.info(
    {
      totalProcessedCount,
      totalProjects,
      totalAnnotations: annotations.length,
    },
    "Finished syncing all annotations"
  );
}
