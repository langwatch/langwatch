import { VStack } from "@chakra-ui/react";
import { EvalCard } from "./EvalCard";
import { EvalHistoryStack } from "./EvalHistoryStack";
import type { EvalEntry, EvalRunHistoryEntry } from "./utils";

export function EvalGroup({
  entries,
  onSelectSpan,
}: {
  entries: EvalEntry[];
  onSelectSpan?: (spanId: string) => void;
}) {
  const head = entries[0]!;
  const history = entries.slice(1);

  // Synthesize a runHistory sparkline from older entries when the eval
  // doesn't carry one already.
  const synthesizedHistory: EvalRunHistoryEntry[] | undefined =
    history.length > 0
      ? entries
          .filter(
            (e): e is EvalEntry & { timestamp: number } => e.timestamp != null,
          )
          .map((e) => ({
            score: e.score,
            timestamp: e.timestamp,
            status: e.status,
          }))
      : undefined;

  const headWithHistory: EvalEntry = {
    ...head,
    runHistory: head.runHistory ?? synthesizedHistory,
  };

  return (
    <VStack align="stretch" gap={0}>
      <EvalCard eval_={headWithHistory} onSelectSpan={onSelectSpan} />
      {history.length > 0 && (
        <EvalHistoryStack entries={history} onSelectSpan={onSelectSpan} />
      )}
    </VStack>
  );
}
