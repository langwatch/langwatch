import { Checkbox } from "@langwatch/design-system/checkbox";
import { Menu } from "@langwatch/design-system/menu";
import { Button, Text, VStack } from "@langwatch/design-system/primitives";
import { ChevronDown } from "lucide-react";

/** A queue the reviewer can narrow the list to. */
export type FilterableQueue = { id: string; name: string };

/** What the trigger says is picked: nothing picked reads every queue. */
function filterLabel({
  queues,
  selected,
}: {
  queues: readonly FilterableQueue[];
  selected: ReadonlySet<string>;
}): string {
  if (selected.size === 0) return "All";
  if (selected.size > 1) return `${selected.size} queues`;
  return queues.find((queue) => selected.has(queue.id))?.name ?? "1 queue";
}

/**
 * Which queues the inbox reads: a reviewer on several queues narrows the pooled
 * list to the one they are working on. Picking nothing reads them all.
 */
export function AnnotationQueueFilter({
  queues,
  selectedQueueIds,
  onSelectedQueueIdsChange,
}: {
  queues: readonly FilterableQueue[];
  selectedQueueIds: readonly string[];
  onSelectedQueueIdsChange: (queueIds: string[]) => void;
}) {
  if (queues.length === 0) return null;

  const selected = new Set(selectedQueueIds);
  const label = filterLabel({ queues, selected });

  const toggle = (queueId: string) => {
    const next = new Set(selected);
    if (next.has(queueId)) next.delete(queueId);
    else next.add(queueId);
    onSelectedQueueIdsChange([...next]);
  };

  return (
    <Menu.Root closeOnSelect={false}>
      <Menu.Trigger asChild>
        <Button variant="outline">
          Queues: {label} <ChevronDown size={16} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <VStack align="start" padding={3} gap={3} maxHeight="320px" overflowY="auto">
          {queues.map((queue) => (
            <Checkbox
              key={queue.id}
              size="sm"
              checked={selected.has(queue.id)}
              onCheckedChange={() => toggle(queue.id)}
            >
              <Text textStyle="sm">{queue.name}</Text>
            </Checkbox>
          ))}
          {selected.size > 0 && (
            <Button size="xs" variant="ghost" onClick={() => onSelectedQueueIdsChange([])}>
              Show all queues
            </Button>
          )}
        </VStack>
      </Menu.Content>
    </Menu.Root>
  );
}
