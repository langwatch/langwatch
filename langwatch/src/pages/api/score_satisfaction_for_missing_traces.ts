import type { NextApiRequest, NextApiResponse } from "next";
import { TRACE_INDEX, esClient } from "../../server/elasticsearch";
import type { Trace } from "../../server/tracer/types";
import { scoreSatisfactionFromInput } from "../../server/background/workers/collector/satisfaction";

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const result = await esClient.search<Trace>({
      index: TRACE_INDEX.alias,
      body: {
        size: 1000,
        query: {
          //@ts-ignore
          bool: {
            must_not: {
              exists: {
                field: "input.satisfaction_score",
              },
            },
          },
        },
      },
    });

    const totalRecords = result.hits.hits.length;

    const records = result.hits.hits
      .map((hit) => hit._source!)
      .filter((x) => x?.input?.embeddings?.embeddings);

    console.log("Going to update", records.length, "records");

    for (let i = 0; i < records.length; i++) {
      const trace = records[i];
      if (!trace) continue;

      try {
        await scoreSatisfactionFromInput({
          traceId: trace.trace_id,
          projectId: trace.project_id,
          input: trace.input,
        });
      } catch {
        console.warn(`Trace ID ${trace.trace_id} failed to score satisfaction`);
      }

      console.log(
        `\r${i + 1}/${totalRecords} record satisfaction score updated`
      );
    }

    res.status(200).json({ message: "Missing satisfaction scores updated" });
  } catch (error: any) {
    res.status(500).json({
      message: "Error starting worker",
      error: error?.message ? error?.message.toString() : `${error}`,
    });
  }
}
