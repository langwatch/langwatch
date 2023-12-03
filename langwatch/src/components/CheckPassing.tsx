import { Box, HStack, Text } from "@chakra-ui/react";
import type { TraceCheck } from "../server/tracer/types";
import type { CheckTypes } from "../trace_checks/types";
import { CheckCircle, Clock, XCircle } from "react-feather";
import { getTraceCheck } from "../trace_checks/frontend/registry";

export function CheckPassing({ check }: { check: TraceCheck }) {
  const checkType = check.check_type as CheckTypes;

  const done =
    check.status === "succeeded" ||
    check.status === "failed" ||
    check.status === "error";
  const checkPasses = check.status === "succeeded";
  const traceCheck = getTraceCheck(checkType);

  if (!traceCheck) return null;
  const TraceCheckComponent = traceCheck.render;

  return (
    <HStack align="start" spacing={2}>
      <Box
        paddingRight={2}
        color={!done ? "yellow.600" : checkPasses ? "green.600" : "red.600"}
      >
        {!done /* TODO: differentiate in_progress and scheduled, also on the general one in Messages */ ? (
          <Clock />
        ) : checkPasses ? (
          <CheckCircle />
        ) : (
          <XCircle />
        )}
      </Box>
      <Text whiteSpace="nowrap">
        <b>{check.check_name || traceCheck.name}:</b>
      </Text>
      {check.status == "succeeded" || check.status == "failed" ? (
        <TraceCheckComponent check={check} />
      ) : check.status == "error" ? (
        <Text>Error</Text>
      ) : check.status == "in_progress" ? (
        <Text>Processing</Text>
      ) : check.status === "scheduled" ? (
        <Text>Scheduled</Text>
      ) : (
        <Text>unknown</Text>
      )}
    </HStack>
  );
}
