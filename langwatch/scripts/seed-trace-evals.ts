/**
 * One-off: inject a handful of evaluation results directly into ClickHouse
 * for an existing trace so the v2 drawer header chip can be screenshotted
 * in every state (pass / score / fail / skipped). Bypasses the
 * event-sourcing queue so it works in a plain `pnpm dev` setup where the
 * worker pipeline isn't necessarily running.
 *
 * Usage:
 *   PROJECT_ID=KAXYxPR8MUgTcP8CF193y TRACE_ID=c2481ff682fc54e912b7016a55db8153 \
 *     npx tsx scripts/seed-trace-evals.ts
 */
import { EvaluationRunClickHouseRepository } from "../src/server/app-layer/evaluations/repositories/evaluation-run.clickhouse.repository";
import { getClickHouseClientForProject } from "../src/server/clickhouse/clickhouseClient";

async function main() {
  const projectId = process.env.PROJECT_ID;
  const traceId = process.env.TRACE_ID;
  if (!projectId || !traceId) {
    throw new Error("PROJECT_ID and TRACE_ID required");
  }

  const repo = new EvaluationRunClickHouseRepository(async (tenantId: string) => {
    const client = await getClickHouseClientForProject(tenantId);
    if (!client) throw new Error(`No ClickHouse client for project ${tenantId}`);
    return client;
  });

  const now = new Date();
  const samples: Array<{
    evaluatorId: string;
    evaluatorType: string;
    evaluatorName: string;
    status: "processed" | "skipped" | "error";
    passed: boolean | null;
    score: number | null;
    label: string | null;
    details: string;
    error: string | null;
  }> = [
    {
      evaluatorId: "presidio/pii_detection",
      evaluatorType: "presidio/pii_detection",
      evaluatorName: "PII Detection",
      status: "processed",
      passed: true,
      score: null,
      label: null,
      details: "No PII entities detected in the message.",
      error: null,
    },
    {
      evaluatorId: "ragas/faithfulness",
      evaluatorType: "ragas/faithfulness",
      evaluatorName: "Faithfulness",
      status: "processed",
      passed: false,
      score: null,
      label: null,
      details: "Answer not grounded in retrieved context.",
      error: null,
    },
    {
      evaluatorId: "lingua/language_detection",
      evaluatorType: "lingua/language_detection",
      evaluatorName: "Language Detection",
      status: "processed",
      passed: null,
      score: 0.92,
      label: "English",
      details: "Detected English with 92% confidence.",
      error: null,
    },
    {
      evaluatorId: "ragas/answer_relevancy",
      evaluatorType: "ragas/answer_relevancy",
      evaluatorName: "Answer Relevancy",
      status: "processed",
      passed: false,
      score: 0.34,
      label: "low relevancy",
      details: "Answer is only weakly grounded in the retrieved context.",
      error: null,
    },
    // No-verdict states — exercise the SKIPPED / ERROR chip badges
    // without depending on whatever evaluations the seed trace already
    // happens to carry.
    {
      evaluatorId: "azure/content_safety",
      evaluatorType: "azure/content_safety",
      evaluatorName: "Content Safety",
      status: "skipped",
      passed: null,
      score: null,
      label: null,
      details:
        "Azure Safety provider not configured. Configure it in Settings → Model Providers to run this evaluator.",
      error: null,
    },
    {
      evaluatorId: "openai/moderation",
      evaluatorType: "openai/moderation",
      evaluatorName: "Moderation",
      status: "error",
      passed: null,
      score: null,
      label: null,
      details: "OpenAI moderation request timed out after 30s.",
      error: "OpenAI moderation request timed out after 30s.",
    },
  ];

  for (const s of samples) {
    // Stable per-evaluator id so re-running the script replaces the row
    // instead of stacking duplicates on the trace.
    const evaluationId = `eval_seed_${s.evaluatorId.replace(/[^a-z0-9]/gi, "_")}_${traceId}`;
    await repo.upsert(
      {
        evaluationId,
        version: "1",
        evaluatorId: s.evaluatorId,
        evaluatorType: s.evaluatorType,
        evaluatorName: s.evaluatorName,
        traceId,
        isGuardrail: false,
        status: s.status,
        score: s.score ?? null,
        passed: s.passed,
        label: s.label,
        details: s.details,
        inputs: null,
        error: s.error,
        errorDetails: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        scheduledAt: now,
        startedAt: now,
        completedAt: now,
        costId: null,
        lastProcessedEventId: `manual:${evaluationId}`,
        lastEventOccurredAt: now,
      } as any,
      projectId,
    );
    console.log(
      `wrote ${s.evaluatorId} status=${s.status} score=${s.score} passed=${s.passed}`,
    );
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
