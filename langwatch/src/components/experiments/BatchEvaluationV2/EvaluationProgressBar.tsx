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
      <Progress.Root
        size={size}
        width="full"
        colorPalette="blue"
        value={isIndeterminate ? null : progress}
        borderRadius="sm"
        max={total ? total : undefined}
        animated
      >
        <Progress.Track>
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>
      {!isIndeterminate && size !== "xs" && (
        <Text whiteSpace="nowrap">
          {progress} / {total}
        </Text>
      )}
    </HStack>
  );
}
