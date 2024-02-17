import { TRACE_INDEX, esClient } from "../server/elasticsearch";
import { getOpenAIEmbeddings } from "../server/embeddings";

const migrateIndex = async (index: string) => {
  let results: any[] = [];

  let searchAfter: any;
  let response;
  let bulkActions = [];

  do {
    response = await esClient.search({
      index,
      _source: {
        includes: ["input.value", "output.value"],
      },
      body: {
        query: {
          //@ts-ignore
          bool: {
            must: {
              exists: {
                field: "input.value",
              },
            },
            must_not: {
              term: {
                "input.embeddings.model": "text-embedding-3-small",
              },
            },
          },
        },
        size: 2_000,
        sort: ["_doc"],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      },
    });
    const records = response.hits.hits;
    results = results.concat(records);
    searchAfter = records[records.length - 1]?.sort;
    process.stdout.write(`\rFetched ${results.length} hits`);

    let inputEmbeddings: (
      | { model: string; embeddings: number[] }
      | undefined
    )[] = [];
    let outputEmbeddings: (
      | { model: string; embeddings: number[] }
      | undefined
    )[] = [];

    for (let i = 0; i < results.length; i += 10) {
      const inputs: (string | undefined)[] = results
        .slice(i, i + 10)
        .map((hit: any) => hit._source.input?.value);
      const outputs: (string | undefined)[] = results
        .slice(i, i + 10)
        .map((hit: any) => hit._source.output?.value);

      process.stdout.write(
        `\rGetting embeddings for ${Math.min(i + 10, results.length)}/${
          results.length
        } records`
      );

      const embeddings = await Promise.all(
        inputs
          .map((input) => (input ? getOpenAIEmbeddings(input) : undefined))
          .concat(
            outputs.map((output) =>
              output ? getOpenAIEmbeddings(output) : undefined
            )
          )
      );
      inputEmbeddings = inputEmbeddings.concat(
        embeddings.slice(0, inputs.length)
      );
      outputEmbeddings = outputEmbeddings.concat(
        embeddings.slice(inputs.length)
      );
    }

    for (let i = 0; i < results.length; i++) {
      const hit = results[i];
      if (!hit) continue;
      const item = hit._source;
      if (!item) continue;

      const inputEmbeddings_ = inputEmbeddings[i];
      const outputEmbeddings_ = outputEmbeddings[i];

      if (!inputEmbeddings_ && !outputEmbeddings_) {
        continue;
      }

      bulkActions.push({
        update: {
          _index: index,
          _id: hit._id,
        },
      });
      bulkActions.push({
        doc: {
          ...(inputEmbeddings_
            ? { input: { embeddings: inputEmbeddings_ } }
            : {}),
          ...(outputEmbeddings_
            ? { output: { embeddings: outputEmbeddings_ } }
            : {}),
        },
      });
      bulkActions.push({
        update: {
          _index: index,
          _id: hit._id,
        },
      });
      bulkActions.push({
        script: {
          source: `
          if (ctx._source.containsKey('input.openai_embeddings')) {
            ctx._source.remove('input.openai_embeddings');
          } else {
            ctx._source.input.remove('openai_embeddings');
          }
          if (ctx._source.containsKey('output.openai_embeddings')) {
            ctx._source.remove('output.openai_embeddings');
          } else {
            ctx._source.output.remove('openai_embeddings');
          }
          if (ctx._source.containsKey('search_embeddings')) {
            ctx._source.search_embeddings.remove('openai_embeddings');
            ctx._source.remove('search_embeddings');
          }
        `,
          lang: "painless",
        },
      });

      process.stdout.write(
        `\r${i + 1}/${results.length} records to be updated`
      );

      if (bulkActions.length >= 400) {
        console.log(`\nUpdating ${bulkActions.length / 4} records`);
        try {
          await esClient.bulk({ body: bulkActions });
          console.log("bulkActions", bulkActions);
          bulkActions = [];
        } catch (error) {
          console.error("Error in bulk update:", error);
        }
      }
    }

    if (bulkActions.length > 0) {
      console.log(`\nUpdating ${bulkActions.length / 4} records`);
      try {
        await esClient.bulk({ body: bulkActions });
      } catch (error) {
        console.error("Error in bulk update:", error);
      }
    }
  } while (response.hits.hits.length > 0);
};

export default async function execute() {
  console.log("\nMigrating Traces");
  await migrateIndex(TRACE_INDEX);
}
