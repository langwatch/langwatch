import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import type { IndexSpec } from "../src/server/elasticsearch";
import { type Client as ElasticClient } from "@elastic/elasticsearch";

export const recreateIndexAndMigrate = async ({
  indexSpec,
  migrationKey,
  mapping,
  client,
}: {
  indexSpec: IndexSpec;
  migrationKey: string;
  mapping: Record<string, MappingProperty>;
  client: ElasticClient;
}) => {
  const newIndex = `${indexSpec.base}-${migrationKey}`;
  // If new index already exists, continue with the interrupted migration
  const indexExists = await client.indices.exists({ index: newIndex });
  let previousIndex: string | undefined;
  if (!indexExists) {
    await createIndex({
      index: newIndex,
      mappings: mapping,
      client,
    });

    previousIndex = await getCurrentWriteIndex({
      indexSpec,
      newIndex,
      client,
    });
  } else {
    console.log(
      `Index ${newIndex} already exists, continuing with interrupted migration`
    );
    const aliasInfo: Record<string, unknown> = await client.indices.getAlias({
      name: indexSpec.alias,
    });
    previousIndex = Object.keys(aliasInfo).find(
      (index) => !index.endsWith("-temp") && index !== newIndex
    );
    if (!previousIndex) {
      throw new Error(
        `No existing previous index found for alias ${indexSpec.alias}`
      );
    }
  }

  await reindexWithAlias({
    indexSpec,
    previousIndex,
    newIndex,
    client,
  });
};

export const getCurrentWriteIndex = async ({
  indexSpec,
  newIndex = undefined,
  client,
}: {
  indexSpec: IndexSpec;
  newIndex?: string;
  client: ElasticClient;
}) => {
  const aliasInfo: Record<string, unknown> = await client.indices.getAlias({
    name: indexSpec.alias,
  });
  const currentIndices = Object.keys(aliasInfo).filter(
    (index) => !index.endsWith("-temp") && index !== newIndex
  );

  // Sort indices and get the most recent one
  const previousIndex = currentIndices.sort().pop();
  if (!previousIndex) {
    throw new Error(
      `No existing write index found for alias ${indexSpec.alias}`
    );
  }
  return previousIndex;
};

export const createIndex = async ({
  index,
  mappings,
  client,
}: {
  index: string;
  mappings: Record<string, MappingProperty>;
  client: ElasticClient;
}) => {
  const indexExists = await client.indices.exists({ index });
  if (!indexExists) {
    await client.indices.create({
      index,
      settings: {
        number_of_shards: 4,
        number_of_replicas: 0,
      },
      mappings: { properties: mappings },
    });
  }
  await client.indices.putMapping({
    index,
    properties: mappings,
  });
};

export const reindexWithAlias = async ({
  indexSpec,
  previousIndex,
  newIndex,
  client,
}: {
  indexSpec: IndexSpec;
  previousIndex: string;
  newIndex: string;
  client: ElasticClient;
}) => {
  console.log(`Reindexing from ${previousIndex} to ${newIndex}`);

  const response = await client.reindex({
    wait_for_completion: false,
    slices: "auto",
    requests_per_second: 200,
    body: {
      conflicts: "proceed",
      source: { index: previousIndex, size: 200 },
      dest: { index: newIndex },
    },
  });

  const taskId = response.task;

  if (!taskId) {
    throw new Error(
      `Reindex task failed to be created: ${JSON.stringify(response)}`
    );
  }

  console.log(`Reindex task started: ${taskId}`);

  await client.indices.updateAliases({
    body: {
      actions: [
        {
          add: {
            index: previousIndex,
            alias: indexSpec.alias,
            is_write_index: false,
          },
        },
        {
          add: {
            index: newIndex,
            alias: indexSpec.alias,
            is_write_index: true,
          },
        },
      ],
    },
  });

  try {
    while (true) {
      const task = await client.tasks.get({
        task_id: taskId.toString(),
      });

      if (task.completed) {
        if (
          task.response &&
          !task.response.timed_out &&
          !task.response.canceled
        ) {
          console.log(`Reindex task ${taskId} completed successfully!`);
          break;
        } else {
          throw new Error(
            `Reindex task failed: ${JSON.stringify(
              task.error ?? task.response
            )}`
          );
        }
      } else {
        // For sliced tasks, we need to get progress from all child tasks
        // since the parent task shows 0 progress
        let totalCreated = 0;
        let totalUpdated = 0;
        let totalVersionConflicts = 0;
        let totalProcessed = 0;
        let hasChildTasks = false;

        // Check if this is a sliced task by looking for child tasks
        try {
          const allTasksResponse = await client.tasks.list({
            actions: "*reindex",
            detailed: true,
            parent_task_id: taskId.toString(),
          });

          if (
            allTasksResponse.nodes &&
            Object.keys(allTasksResponse.nodes).length > 0
          ) {
            hasChildTasks = true;

            // Aggregate progress from all child tasks
            for (const nodeId in allTasksResponse.nodes) {
              const nodeTasks = allTasksResponse.nodes[nodeId]!.tasks;
              for (const childTaskId in nodeTasks) {
                const childTask = nodeTasks[childTaskId]!;
                if (childTask.status) {
                  totalCreated += childTask.status.created || 0;
                  totalUpdated += childTask.status.updated || 0;
                  totalVersionConflicts += childTask.status.version_conflicts || 0;
                  totalProcessed +=
                    (childTask.status.created || 0) +
                    (childTask.status.updated || 0) +
                    (childTask.status.version_conflicts || 0);
                }
              }
            }
          }
        } catch (childTaskError) {
          console.warn(
            "⚠️ Could not fetch child task progress:",
            (childTaskError as any).message
          );
        }

        // Show progress
        if (hasChildTasks && totalProcessed > 0) {
          console.log(
            `[${new Date().toISOString()}] Reindex progress: ${totalProcessed} processed [Created: ${totalCreated}, Updated: ${totalUpdated}, Version Conflicts: ${totalVersionConflicts}]`
          );
        } else {
          // Fallback to parent task status if no child tasks found
          console.log(
            `[${new Date().toISOString()}] Reindex task status: ${JSON.stringify(
              task.task.status
            )}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
    }

    await client.indices.updateAliases({
      body: {
        actions: [
          {
            remove: {
              index: previousIndex,
              alias: indexSpec.alias,
            },
          },
        ],
      },
    });
    console.log(`Deleting old index in 10 seconds...`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    await client.indices.delete({ index: previousIndex });
    console.log(`Deleted old index ${previousIndex}`);
  } catch (error) {
    await client.indices.updateAliases({
      body: {
        actions: [
          {
            add: {
              index: newIndex,
              alias: indexSpec.alias,
              is_write_index: false,
            },
          },
          {
            add: {
              index: previousIndex,
              alias: indexSpec.alias,
              is_write_index: true,
            },
          },
        ],
      },
    });

    throw error;
  }
};
