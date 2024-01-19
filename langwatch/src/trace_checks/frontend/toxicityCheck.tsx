import { Box, Text } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { ModerationResult } from "../types";

export function ToxicityCheck({ check }: { check: TraceCheck }) {
  const moderationResult = check.raw_result as ModerationResult;
  if (!moderationResult.categoriesAnalysis) {
    return <Box>Moderation Result did not load</Box>;
  }

  const categories = moderationResult.categoriesAnalysis
    .filter((result) => result.severity > 0)
    .map((result) => result.category);

  return (
    <Box>
      {categories && Object.entries(categories).some(([_, value]) => value)
        ? Object.entries(categories).map(([category, value]) =>
            value ? <Text key={category}>Flagged for {category}</Text> : null
          )
        : "No issues detected"}
    </Box>
  );
}
