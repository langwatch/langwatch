import { Box, Text } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { TraceCheckFrontendDefinition } from "../types";
import type { ModerationResult } from "../types";

function CheckDetails({ check }: { check: TraceCheck }) {
  const moderationResult = check.raw_result as ModerationResult;
  const categories = moderationResult.results[0]?.categories;

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

export const ToxicityCheck: TraceCheckFrontendDefinition = {
  name: "OpenAI Moderation",
  description: "Detects hate speech, harassment, violence, and other toxic content",
  render: CheckDetails,
};
