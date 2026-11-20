import type {
  InstantEvalMonitorJudgementAnswer,
  InstantEvalMonitorJudgment,
} from "@langwatch/instant-eval-contract";
import type { InstantEvalVerdict } from "@langwatch/instant-eval-judge-contract";

import type { EvaluationInstantEvalResults } from "../evaluation-instant-eval-results.channel.ts";

/** One operation a test sees asked of instant-eval. */
interface MemoryInstantEvalResultsCall {
  readonly operation: "find" | "keep";
  readonly monitorId: string;
}

/**
 * Instant-eval's kept monitor judgments held in process, for a process without instant-eval: a
 * judged verdict is answered again for the same trace, question, texts and judge model.
 */
export class MemoryEvaluationInstantEvalResultsChannel implements EvaluationInstantEvalResults {
  readonly calls: MemoryInstantEvalResultsCall[] = [];
  private readonly kept = new Map<string, InstantEvalVerdict>();

  static create(): MemoryEvaluationInstantEvalResultsChannel {
    return new MemoryEvaluationInstantEvalResultsChannel();
  }

  private constructor() {}

  async findMonitorJudgments(input: InstantEvalMonitorJudgment): Promise<InstantEvalVerdict[]> {
    this.calls.push({ operation: "find", monitorId: input.monitorId });
    const verdict = this.kept.get(keyOf(input));
    return verdict ? [verdict] : [];
  }

  async keepMonitorJudgment({
    judgement,
    ...judgment
  }: InstantEvalMonitorJudgment & { judgement: InstantEvalMonitorJudgementAnswer }): Promise<void> {
    this.calls.push({ operation: "keep", monitorId: judgment.monitorId });
    const verdict = judgement.verdicts.find(
      (answer) => answer.questionId === judgment.question.id,
    );
    if (verdict && !judgement.skippedReason) this.kept.set(keyOf(judgment), verdict);
  }
}

/** What instant-eval recalls on; the monitor is provenance only, so it is not part of it. */
function keyOf(judgment: InstantEvalMonitorJudgment): string {
  const { projectId, traceId, question, inputs, judgeModel } = judgment;
  return JSON.stringify([projectId, traceId, question, inputs, judgeModel]);
}
