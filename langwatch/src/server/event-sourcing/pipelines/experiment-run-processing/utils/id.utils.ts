import { createHash } from "crypto";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

function generateDeterministicResultId({
  tenantId,
  runId,
  index,
  targetId,
  resultType,
  evaluatorId,
}: {
  tenantId: string;
  runId: string;
  index: number;
  targetId: string;
  resultType: "target" | "evaluator";
  evaluatorId: string | null;
}): string {
  if (resultType === "evaluator" && !evaluatorId) {
    throw new Error("evaluatorId is required for evaluator results");
  }
  if (resultType === "target" && evaluatorId != null) {
    throw new Error("evaluatorId must be null for target results");
  }

  const hashInput = evaluatorId
    ? `${tenantId}:${runId}:${index}:${targetId}:${evaluatorId}:${resultType}`
    : `${tenantId}:${runId}:${index}:${targetId}:${resultType}`;

  const hash = createHash("sha256").update(hashInput).digest();
  const instanceIdentifier = new Uint8Array(hash.subarray(0, 8));
  const instance = new Instance(Instance.schemes.RANDOM, instanceIdentifier);
  // Use epoch 0 so the ID depends only on the business key hash
  const timestampSeconds = 0;
  const sequenceId = 0;

  const ksuid = new Ksuid(
    getEnvironment(),
    KSUID_RESOURCES.EXPERIMENT_RUN_RESULT,
    timestampSeconds,
    instance,
    sequenceId,
  );

  return ksuid.toString();
}

export const IdUtils = {
  generateDeterministicResultId,
} as const;
