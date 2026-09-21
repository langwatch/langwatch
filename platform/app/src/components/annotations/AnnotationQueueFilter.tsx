import { Button, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "../ui/checkbox";
import { Menu } from "../ui/menu";

/** A queue the reviewer can narrow the list to. */
export type FilterableQueue = { id: string; name: string };

/**
 * Which queues the inbox reads. The inbox pools every queue the reviewer
 * belongs to, so on a project with several of them the list is a mix nobody
 * asked for: this is how a reviewer gets down to the one they are working on
 * without leaving the page that counts all their pending work.
 *
 * Picking nothing reads them all, which is what the label says rather than
 * leaving the reviewer to infer it from an empty control.
 */
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
  const label =
    selected.size === 0
      ? "All"
      : selected.size === 1
        ? (queues.find((queue) => selected.has(queue.id))?.name ?? "1 queue")
        : `${selected.size} queues`;

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
        <VStack
          align="start"
          padding={3}
          gap={3}
          maxHeight="320px"
          overflowY="auto"
        >
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
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onSelectedQueueIdsChange([])}
            >
              Show all queues
            </Button>
          )}
        </VStack>
      </Menu.Content>
    </Menu.Root>
  );
}
