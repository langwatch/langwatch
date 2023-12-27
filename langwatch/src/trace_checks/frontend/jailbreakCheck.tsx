import { Box, Text } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { JailbreakAnalysisResult, TraceCheckFrontendDefinition } from "../types";

function CheckDetails({ check }: { check: TraceCheck }) {
  const detected = (check.raw_result as JailbreakAnalysisResult)
    .jailbreakAnalysis.detected;

  return (
    <Box>
      {detected ? (
        <Text>Jailbreak attempt detected</Text>
      ) : (
        "No jailbreak content detected"
      )}
    </Box>
  );
}

export const JailbreakCheck: TraceCheckFrontendDefinition = {
  name: "Jailbreak Detection",
  description:
    "Detects if the input attempts to Jailbreak the LLM to produce answers and execute tasks that it was not supposed to",
  render: CheckDetails,
};
