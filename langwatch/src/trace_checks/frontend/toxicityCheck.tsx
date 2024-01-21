import { Box, Text } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { ModerationResult } from "../types";

export function ToxicityCheck({ check }: { check: TraceCheck }) {
  const moderationResult = check.raw_result as ModerationResult;
  if (!moderationResult.categoriesAnalysis) {
    return <Box>Moderation Result did not load</Box>;
  }

  const detectedCategories = moderationResult.categoriesAnalysis.filter(
    (result) => result.severity > 0
  );

  return (
    <Box>
      {detectedCategories.length > 0
        ? detectedCategories.map((result) =>
            result ? (
              <Text key={result.category}>
                Flagged for {result.category} (severity {result.severity})
              </Text>
            ) : null
          )
        : "No issues detected"}
    </Box>
  );
}
