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

export const ToxicityCheck: TraceCheckFrontendDefinition<"toxicity_check"> = {
  name: "OpenAI Moderation",
  description:
    "Detects hate speech, harassment, violence, and other toxic content",
  parametersDescription: {
    categories: {
      name: "Categories to check",
      description: "The categories of moderation to check for",
    },
  },
  default: {
    parameters: {
      categories: {
        harassment: true,
        "harassment/threatening": true,
        hate: true,
        "hate/threatening": true,
        "self-harm": true,
        "self-harm/intent": true,
        "self-harm/instructions": true,
        sexual: true,
        "sexual/minors": true,
        violence: true,
        "violence/graphic": true,
      },
    },
  },
  render: CheckDetails,
};
