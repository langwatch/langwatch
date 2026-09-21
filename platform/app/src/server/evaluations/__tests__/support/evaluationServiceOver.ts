import { vi } from "vitest";
import { TraceEvaluationsClickHouseRepository } from "~/server/app-layer/evaluations/repositories/trace-evaluations.clickhouse.repository";
import { EvaluationService } from "../../evaluation.service";

/**
 * The service under test over a fake ClickHouse client.
 *
 * Both evaluation suites want the same thing: the real repository, so the
 * query, the dedup and the memory-limit retry all run, over a client they
 * control. Shared here because the two had the same ten lines, doc comment
 * included, and a change to the repository's construction had to be made
 * twice.
 */
export const resolveClient = vi.fn();

export function serviceOver(client: unknown): EvaluationService {
  resolveClient.mockResolvedValue(client);
  return serviceOverResolver();
}

/** The same service over a resolver that rejects, for the unavailable case. */
export function serviceOverUnavailable(error: Error): EvaluationService {
  resolveClient.mockRejectedValue(error);
  return serviceOverResolver();
}

function serviceOverResolver(): EvaluationService {
  return new EvaluationService({
    repository: new TraceEvaluationsClickHouseRepository(resolveClient),
  });
}
