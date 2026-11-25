import { ownProofAuthorizer } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { MemoryTraceEvaluationAnalyticsRepository } from "../../repositories/memory/memory.trace-evaluation-analytics.repository.ts";
import { TraceEvaluationAnalyticsStore } from "../trace-evaluation-analytics.store.ts";

/** The evaluation rows store over memory, for a trace analytics store test that writes none. */
export function memoryEvaluationAnalytics({
  storage = MemoryTraceEvaluationAnalyticsRepository.create(),
  now,
}: {
  storage?: MemoryTraceEvaluationAnalyticsRepository;
  now?: () => number;
} = {}): TraceEvaluationAnalyticsStore {
  return TraceEvaluationAnalyticsStore.create({
    storage,
    defaultRetentionDays: () => 90,
    authorize: ownProofAuthorizer,
    ...(now ? { now } : {}),
  });
}
