import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { prisma } from "../server/db";
import { TRACE_CHECKS_INDEX, esClient } from "../server/elasticsearch";
import type { TraceCheck } from "../server/tracer/types";
import type { EvaluatorTypes } from "../trace_checks/evaluators.generated";

const migrateIndex = async (index: string) => {
  let searchAfter: any;
  let response;
  let bulkActions = [];

  const checkTypeMap: Record<string, EvaluatorTypes> = {
    pii_check: "google_cloud/dlp_pii_detection",
    jailbreak_check: "azure/jailbreak",
    toxicity_check: "azure/content_safety",
    ragas_answer_relevancy: "ragas/answer_relevancy",
    ragas_context_utilization: "ragas/context_utilization",
    ragas_faithfulness: "ragas/faithfulness",
    language_check: "lingua/language_detection",
    custom: "custom/basic",
  };

  const customChecks = await prisma.check.findMany({
    where: {
      checkType: "custom",
    },
  });

  const customChecksByIdToNewCheckTypeMap: Record<string, EvaluatorTypes> =
    Object.fromEntries(
      customChecks.map((check) => {
        const rules: any[] = (check.parameters as any)?.rules || [];
        let newCheckType: EvaluatorTypes = "custom/basic";

        if (rules.some((rule) => rule.rule === "llm_boolean")) {
          newCheckType = "custom/llm_boolean";
        }
        if (rules.some((rule) => rule.rule === "llm_score")) {
          newCheckType = "custom/llm_score";
        }
        if (rules.some((rule) => rule.rule === "is_similar_to")) {
          newCheckType = "custom/similarity";
        }

        return [check.id, newCheckType];
      })
    );

  do {
    response = await esClient.search<TraceCheck>({
      index,
      _source: {
        includes: ["check_id", "check_type", "status", "value"],
      },
      body: {
        size: 500,
        query: {
          bool: {
            must_not: {
              exists: {
                field: "score",
              },
            },
          } as QueryDslBoolQuery,
        },
        sort: ["_doc"],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      },
    });
    const results = response.hits.hits;
    searchAfter = results[results.length - 1]?.sort;
    process.stdout.write(
      `\nFetched ${results.length} more hits from ${
        (response as any).hits.total.value
      } total\n`
    );

    for (let i = 0; i < results.length; i++) {
      const hit = results[i];
      if (!hit?._source) continue;

      let newCheckType =
        checkTypeMap[hit._source?.check_type ?? ""] ?? "unknown";

      if (newCheckType === "custom/basic") {
        newCheckType =
          customChecksByIdToNewCheckTypeMap[hit._source.check_id] ??
          "custom/basic";
      }

      const isOldStatus = ["succeeded", "failed"].includes(hit._source.status);

      bulkActions.push({
        update: {
          _index: index,
          _id: hit._id,
        },
      });
      bulkActions.push({
        doc: {
          check_type: newCheckType,
          status: isOldStatus ? "processed" : hit._source.status,
          ...(isOldStatus
            ? { passed: (hit._source.status as any) === "succeeded" }
            : {}),
          timestamps: {
            updated_at: Date.now(),
          },
        },
      });

      bulkActions.push({ update: { _index: index, _id: hit._id } });

      bulkActions.push({
        script: {
          source: `
            if (ctx._source.value != null) {
              ctx._source.score = ctx._source.value;
              ctx._source.remove('value');
            }
          `,
          lang: "painless",
        },
      });

      process.stdout.write(`\r${i + 1}/${results.length} being updated`);

      if (bulkActions.length >= 400) {
        try {
          await esClient.bulk({ body: bulkActions });
          bulkActions = [];
        } catch (error) {
          console.error("Error in bulk update:", error);
        }
      }
    }

    if (bulkActions.length > 0) {
      try {
        await esClient.bulk({ body: bulkActions });
      } catch (error) {
        console.error("Error in bulk update:", error);
      }
    }
  } while (response.hits.hits.length > 0);

  for (const [checkType, evaluatorType] of Object.entries(checkTypeMap)) {
    if (evaluatorType === "custom/basic") continue;
    await prisma.check.updateMany({
      where: {
        checkType: checkType,
      },
      data: {
        checkType: evaluatorType,
      },
    });
  }

  for (const [checkId, evaluatorType] of Object.entries(
    customChecksByIdToNewCheckTypeMap
  )) {
    await prisma.check.update({
      where: {
        id: checkId,
      },
      data: {
        checkType: evaluatorType,
      },
    });
  }
};

export default async function execute() {
  console.log("\nMigrating Trace Checks");
  await migrateIndex(TRACE_CHECKS_INDEX);
}
