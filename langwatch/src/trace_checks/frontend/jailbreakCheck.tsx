import { Box, Text } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { JailbreakAnalysisResult } from "../types";

export function JailbreakCheck({ check }: { check: TraceCheck }) {
  const detected = (check.raw_result as JailbreakAnalysisResult | undefined)
    ?.jailbreakAnalysis?.detected;

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
