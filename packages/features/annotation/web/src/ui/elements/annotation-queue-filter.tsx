import { Button, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Menu } from "@langwatch/design-system/menu";

/** A queue the reviewer can narrow the list to. */
export type FilterableQueue = { id: string; name: string };

/** How the current selection reads on the filter trigger. */
function queueFilterLabel({
  queues,
  selected,
}: {
  queues: FilterableQueue[];
  selected: Set<string>;
}): string {
  if (selected.size === 0) return "All";

  if (selected.size === 1) {
    return queues.find((queue) => selected.has(queue.id))?.name ?? "1 queue";
  }

  return `${selected.size} queues`;
}

/** The inbox can narrow pooled work to one queue. */
export function AnnotationQueueFilter({
  queues,
  selectedQueueIds,
  onSelectedQueueIdsChange,
}: {
  queues: FilterableQueue[];
  selectedQueueIds: string[];
  onSelectedQueueIdsChange: (queueIds: string[]) => void;
}) {
  if (queues.length === 0) return null;

  const selected = new Set(selectedQueueIds);
  const label = queueFilterLabel({ queues, selected });

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
