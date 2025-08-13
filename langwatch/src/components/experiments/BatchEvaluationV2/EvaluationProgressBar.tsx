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

  // Ensure progress never exceeds total to prevent validation errors
  const safeProgress = Math.min(progress, total);
  const safeTotal = Math.max(total, 1); // Ensure total is at least 1

  return (
    <HStack width="full" gap={4}>
      {!isIndeterminate && size !== "xs" && (
        <Text whiteSpace="nowrap">
          {Math.round((safeProgress / safeTotal) * 100)}%
        </Text>
      )}
      <Progress.Root
        size={size}
        width="full"
        colorPalette="blue"
        value={isIndeterminate ? null : safeProgress}
        max={safeTotal}
        animated
        striped
      >
        <Progress.Track borderRadius="sm">
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>
      {!isIndeterminate && size !== "xs" && (
        <Text whiteSpace="nowrap">
          {safeProgress} / {safeTotal}
        </Text>
      )}
    </HStack>
  );
}
