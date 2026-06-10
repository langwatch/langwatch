import { Button, Icon, Text, VStack } from "@chakra-ui/react";
import { LuFlaskConical } from "react-icons/lu";
import { EvalGroup } from "./EvalGroup";
import { type EvalEntry, evalGroupKey } from "./utils";

interface EvalsListProps {
  evals: EvalEntry[];
  onSelectSpan?: (spanId: string) => void;
}

export function EvalsList({ evals, onSelectSpan }: EvalsListProps) {
  if (!evals || evals.length === 0) {
    return (
      <VStack
        gap={2}
        alignItems="center"
        textAlign="center"
        maxWidth="220px"
        marginX="auto"
        paddingY={3}
      >
        <Icon as={LuFlaskConical} boxSize={5} color="fg.subtle" />
        <VStack gap={1}>
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">
            No evaluations yet
          </Text>
          <Text textStyle="xs" color="fg.subtle">
            Set up evaluators to automatically score traces on quality, safety,
            and accuracy.
          </Text>
        </VStack>
        <Button size="xs" variant="outline" asChild>
          <a
            href="https://docs.langwatch.ai/evaluations/overview"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn more
          </a>
        </Button>
      </VStack>
    );
  }

  // Group runs by evaluator, then sort each group newest-first. The first
  // entry in each group is the head card; the rest collapse into a history
  // panel so a noisy evaluator doesn't dominate the section.
  const groups = new Map<string, EvalEntry[]>();
  for (const e of evals) {
    const key = evalGroupKey(e);
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  const orderedGroups = Array.from(groups.values()).map((entries) =>
    [...entries].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)),
  );
  // Order groups by their head entry's timestamp (newest evaluator first).
  orderedGroups.sort((a, b) => (b[0]?.timestamp ?? 0) - (a[0]?.timestamp ?? 0));

  return (
    <VStack align="stretch" gap={2}>
      {orderedGroups.map((group) => (
        <EvalGroup
          key={evalGroupKey(group[0]!)}
          entries={group}
          onSelectSpan={onSelectSpan}
        />
      ))}
    </VStack>
  );
}
