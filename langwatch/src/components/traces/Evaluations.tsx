import { Text, VStack } from "@chakra-ui/react";
import { type Project } from "@prisma/client";
import type { ElasticSearchEvaluation } from "~/server/tracer/types";
import { evaluationPassed } from "../checks/EvaluationStatus";
import { Link } from "../ui/link";
import { EvaluationStatusItem } from "./EvaluationStatusItem";

interface TraceEval {
  project?: Project;
  traceId: string;
  evaluations?: ElasticSearchEvaluation[];
}

export function Evaluations(trace: TraceEval & { anyGuardrails: boolean }) {
  const evaluations = trace.evaluations?.filter((x) => !x.is_guardrail);
  const totalChecks = evaluations?.length;
  if (!totalChecks)
    return (
      <Text>
        No evaluations ran for this message.{" "}
        {trace.anyGuardrails ? (
          "Evaluations are skipped if guardrails completely blocked the message."
        ) : (
          <>
            Setup evaluations{" "}
            <Link
              href={`/${trace.project?.slug}/evaluations`}
              textDecoration="underline"
            >
              here
            </Link>
            .
          </>
        )}
      </Text>
    );
  return (
    <VStack align="start" gap={2}>
      <>
        {evaluations?.map((evaluation) => (
          <EvaluationStatusItem
            key={evaluation.evaluation_id}
            check={evaluation}
          />
        ))}
      </>
    </VStack>
  );
}

export const Guardrails = (trace: TraceEval) => {
  const guardrails = trace.evaluations?.filter((x) => x.is_guardrail);
  const totalChecks = guardrails?.length;
  if (!totalChecks)
    return (
      <Text>
        No guardrails ran for this message. Setup guardrails{" "}
        <Link
          href={`/${trace.project?.slug}/evaluations`}
          textDecoration="underline"
        >
          here
        </Link>
        .
      </Text>
    );
  return (
    <VStack align="start" gap={2}>
      <>
        {guardrails?.map((evaluation) => (
          <EvaluationStatusItem
            key={evaluation.evaluation_id}
            check={evaluation}
          />
        ))}
      </>
    </VStack>
  );
};

export const EvaluationsCount = (
  trace: TraceEval & { countGuardrails: boolean }
) => {
  const evaluations = trace.countGuardrails
    ? trace.evaluations?.filter((x) => x.is_guardrail)
    : trace.evaluations?.filter((x) => !x.is_guardrail);
  const totalErrors =
    evaluations?.filter(
      (check) => check.status === "error" || evaluationPassed(check) === false
    ).length ?? 0;

  if (totalErrors > 0) {
    if (trace.countGuardrails) {
      return null;
    }

    return (
      <Text
        borderRadius={"md"}
        paddingX={2}
        backgroundColor={"red.500"}
        color={"white"}
        fontSize={"sm"}
      >
        {totalErrors} failed
      </Text>
    );
  }

  const totalProcessed =
    evaluations?.filter((check) => check.status === "processed").length ?? 0;
  const total = evaluations?.length ?? 0;

  if (total === 0) return null;

  return (
    <Text
      borderRadius={"md"}
      paddingX={2}
      backgroundColor={totalProcessed > 0 ? "green.500" : "yellow.500"}
      color={"white"}
      fontSize={"sm"}
    >
      {totalProcessed > 0 ? totalProcessed : total}
    </Text>
  );
};

export const Blocked = (trace: TraceEval) => {
  const totalBlocked = trace
    ? trace.evaluations?.filter(
        (check) => check.is_guardrail && check.passed === false
      ).length
    : 0;

  if (totalBlocked === 0 || !totalBlocked) return null;

  return (
    <Text
      borderRadius={"md"}
      paddingX={2}
      backgroundColor={"blue.100"}
      fontSize={"sm"}
    >
      {totalBlocked} blocked
    </Text>
  );
};
