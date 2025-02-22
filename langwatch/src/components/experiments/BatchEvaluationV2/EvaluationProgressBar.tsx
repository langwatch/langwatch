import { HStack, Progress, Text } from "@chakra-ui/react";

export function EvaluationProgressBar({
  evaluationState,
  size = "xs",
}: {
  evaluationState:
    | { progress?: number | null; total?: number | null; status?: string }
    | undefined;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const progress = evaluationState?.progress ?? 0;
  const total = evaluationState?.total ?? 100;
  const isIndeterminate =
    evaluationState?.status === "waiting" || !evaluationState?.total;

  return (
    <HStack width="full" gap={4}>
      {!isIndeterminate && size !== "xs" && (
        <Text whiteSpace="nowrap">{Math.round((progress / total) * 100)}%</Text>
      )}
      <Progress
        size={size}
        width="full"
        colorPalette="blue"
        isIndeterminate={isIndeterminate}
        isAnimated
        borderRadius="sm"
        value={progress}
        max={total ? total : undefined}
        hasStripe
      />
      {!isIndeterminate && size !== "xs" && (
        <Text whiteSpace="nowrap">
          {progress} / {total}
        </Text>
      )}
    </HStack>
  );
}
