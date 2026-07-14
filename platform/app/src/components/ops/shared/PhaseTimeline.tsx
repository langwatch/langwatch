import { HStack, Text } from "@chakra-ui/react";

export const PHASE_ICONS: Record<string, string> = {
  mark: "\u2691",
  pause: "\u23F8",
  drain: "\u2248",
  cutoff: "\u2702",
  replay: "\u25B6",
  write: "\u270E",
  unmark: "\u2713",
  discover: "\uD83D\uDD0D",
  complete: "\u2714",
};

export const PHASE_LABELS: Record<string, string> = {
  mark: "Marking aggregates",
  pause: "Pausing projections",
  drain: "Draining active jobs",
  cutoff: "Recording cutoff points",
  replay: "Replaying events",
  write: "Writing projection states",
  unmark: "Unmarking & resuming",
  discover: "Discovering aggregates",
  complete: "Complete",
};

const PHASES = ["discover", "mark", "pause", "drain", "cutoff", "replay", "write", "unmark"];

export function PhaseTimeline({
  currentPhase,
  completedState,
}: {
  currentPhase: string | null;
  completedState?: "completed" | "failed" | "cancelled" | null;
}) {
  const currentIdx = currentPhase ? PHASES.indexOf(currentPhase) : -1;

  return (
    <HStack gap={1} flexWrap="wrap">
      {PHASES.map((phase, i) => {
        const isDone = completedState === "completed" || i < currentIdx;
        const isCurrent = !completedState && i === currentIdx;
        const icon = PHASE_ICONS[phase] ?? "·";

        return (
          <HStack
            key={phase}
            gap={1}
            paddingX={1.5}
            paddingY={0.5}
            borderRadius="sm"
            bg={isCurrent ? "orange.subtle" : isDone ? "green.subtle" : "bg.muted"}
            opacity={isDone || isCurrent ? 1 : 0.4}
          >
            <Text textStyle="xs">{icon}</Text>
            <Text
              textStyle="xs"
              fontWeight={isCurrent ? "semibold" : "normal"}
              color={isCurrent ? "orange.fg" : isDone ? "green.fg" : "fg.muted"}
            >
              {phase}
            </Text>
          </HStack>
        );
      })}
    </HStack>
  );
}
