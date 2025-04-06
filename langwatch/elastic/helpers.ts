import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import type { IndexSpec } from "../src/server/elasticsearch";
import { esClient } from "../src/server/elasticsearch";
import { Client as ElasticClient } from "@elastic/elasticsearch";
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
  await createIndex({
    index: newIndex,
    mappings: mapping,
    client,
  });

  const previousIndex = await getCurrentWriteIndex({
    indexSpec,
    newIndex,
    client,
  });
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
        number_of_shards: 1,
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

      console.log(
        `[${new Date().toISOString()}] Reindex task status: ${JSON.stringify(
          task.task.status
        )}`
      );

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
