import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import type { ReactNode } from "react";
import { useState } from "react";
import type { ElasticSearchEvaluation } from "~/server/tracer/types";
import { evaluationPassed } from "../checks/EvaluationStatus";
import { Link } from "../ui/link";
import { EvaluationStatusItem } from "./EvaluationStatusItem";
import {
  groupEvaluationsByEvaluator,
  type EvaluationGroup,
} from "./groupEvaluations";

interface TraceEval {
  project?: Project;
  traceId: string;
  evaluations?: ElasticSearchEvaluation[];
}

/** Indentation matching the width of the evaluation status icon. */
const EVALUATION_STATUS_INDENT = "22px";

function EvaluationGroupEntry({ group }: { group: EvaluationGroup }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Box width="full">
      <EvaluationStatusItem check={group.latest} />
      {group.hasPreviousRuns && (
        <HStack paddingLeft={EVALUATION_STATUS_INDENT} marginTop={1}>
          <Text
            fontSize="xs"
            color="fg.subtle"
            cursor="pointer"
            _hover={{ textDecoration: "underline" }}
            onClick={() => setIsExpanded(!isExpanded)}
            role="button"
            aria-expanded={isExpanded}
          >
            +{group.previousRunCount} previous
          </Text>
        </HStack>
      )}
      {isExpanded &&
        group.runs.slice(1).map((run) => (
          <Box
            key={run.evaluation_id}
            paddingLeft={EVALUATION_STATUS_INDENT}
            marginTop={2}
            borderLeftWidth="2px"
            borderLeftColor="border.subtle"
            marginLeft="4px"
          >
            <EvaluationStatusItem check={run} />
          </Box>
        ))}
    </Box>
  );
}

/** Renders a list of evaluation groups with dividers between entries. */
function EvaluationGroupList({
  groups,
  emptyState,
}: {
  groups: EvaluationGroup[];
  emptyState: ReactNode;
}) {
  if (groups.length === 0) return <>{emptyState}</>;

  return (
    <VStack align="start" gap={0} width="full">
      {groups.map((group, index) => (
        <Box key={group.latest.evaluation_id} width="full">
          {index > 0 && (
            <Box
              borderTopWidth="1px"
              borderTopColor="border.subtle"
              marginY={3}
            />
          )}
          <EvaluationGroupEntry group={group} />
        </Box>
      ))}
    </VStack>
  );
}

export function Evaluations(trace: TraceEval & { anyGuardrails: boolean }) {
  const evaluations = trace.evaluations?.filter((x) => !x.is_guardrail);
  const groups = groupEvaluationsByEvaluator(evaluations);

  return (
    <EvaluationGroupList
      groups={groups}
      emptyState={
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
      }
    />
  );
}

export const Guardrails = (trace: TraceEval) => {
  const guardrails = trace.evaluations?.filter((x) => x.is_guardrail);
  const groups = groupEvaluationsByEvaluator(guardrails);

  return (
    <EvaluationGroupList
      groups={groups}
      emptyState={
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
      }
    />
  );
};

export const EvaluationsCount = (
  trace: TraceEval & { countGuardrails?: boolean },
) => {
  const evaluations = trace.countGuardrails
    ? trace.evaluations?.filter((x) => x.is_guardrail)
    : trace.evaluations?.filter((x) => !x.is_guardrail);

  const groups = groupEvaluationsByEvaluator(evaluations);

  let totalErrors = 0;
  let totalProcessed = 0;
  for (const group of groups) {
    if (
      group.latest.status === "error" ||
      evaluationPassed(group.latest) === false
    ) {
      totalErrors++;
    }
    if (group.latest.status === "processed") {
      totalProcessed++;
    }
  }

  if (totalErrors > 0) {
    if (trace.countGuardrails) {
      return null;
    }

    return (
      <Text
        borderRadius={"md"}
        paddingX={2}
        backgroundColor={"red.solid"}
        color={"white"}
        fontSize={"sm"}
      >
        {totalErrors} failed
      </Text>
    );
  }

  const total = groups.length;

  if (total === 0) return null;

  return (
    <Text
      borderRadius={"md"}
      paddingX={2}
      backgroundColor={totalProcessed > 0 ? "green.solid" : "yellow.solid"}
      color={"white"}
      fontSize={"sm"}
    >
      {totalProcessed > 0 ? totalProcessed : total}
    </Text>
  );
};

export const Blocked = (trace: TraceEval) => {
  const guardrails = trace.evaluations?.filter((x) => x.is_guardrail);
  const groups = groupEvaluationsByEvaluator(guardrails);

  let totalBlocked = 0;
  for (const group of groups) {
    if (group.latest.passed === false) {
      totalBlocked++;
    }
  }

  if (totalBlocked === 0) return null;

  return (
    <Text
      borderRadius={"md"}
      paddingX={2}
      backgroundColor={"blue.subtle"}
      color={"blue.fg"}
      fontSize={"sm"}
    >
      {totalBlocked} blocked
    </Text>
  );
};
