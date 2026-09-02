/**
 * Who a set of traces is being sent to: people, queues, or both.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/components/traces/AddParticipants`.
 * That component is exclusive to the send dialog, but the dialog itself is not
 * exclusive to this family — the trace table's bulk bar and the trace drawer's
 * overflow menu both open it — so the platform pair stays for them and this one
 * travels with the annotation lists.
 *
 * The two lists come from two reads and are ordered deliberately: QUEUES FIRST,
 * because a queue reaches whoever is on it and so is the answer most of the
 * time; a person is the exception.
 *
 * NARROWED: the platform component takes an `isTrigger` flag that hides its own
 * Send button for a caller that renders one. Both callers here render the
 * dialog's footer, so the flag has no caller and is gone.
 */

import {
  Badge,
  Box,
  Button,
  CloseButton,
  createListCollection,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Select } from "@langwatch/design-system/select";
import { Plus, Users } from "lucide-react";
import { ReviewerAvatar } from "../elements/reviewer-avatar";

/** A person or a queue, named the way the queue reads name them. */
export type QueueParticipant = { id: string; name: string };

export function QueueParticipants({
  annotators,
  setAnnotators,
  queues,
  members,
  onCreateQueue,
  onSend,
  isSending,
}: {
  annotators: QueueParticipant[];
  setAnnotators: (annotators: QueueParticipant[]) => void;
  queues: ReadonlyArray<{ id: string; name: string }>;
  members: ReadonlyArray<{ user: { id: string; name: string | null; image: string | null } }>;
  /** Opens the queue editor on a new queue. */
  onCreateQueue: () => void;
  onSend: () => void;
  isSending: boolean;
}) {
  const options = [
    ...queues.map((queue) => ({
      label: queue.name ?? "",
      value: `queue-${queue.id}`,
      // Queues have no avatar image; keep the option shape uniform.
      image: null as string | null,
    })),
    ...members.map((member) => ({
      label: member.user.name ?? "",
      value: `user-${member.user.id}`,
      image: member.user.image,
    })),
  ];

  const collection = createListCollection({ items: options });
  const left = collection.items.filter(
    (item) => !annotators.some((annotator) => annotator.id === item.value),
  );

  return (
    <VStack width="full" align="start">
      <Text>Send to:</Text>

      <Select.Root
        collection={collection}
        multiple
        value={annotators.map((annotator) => annotator.id)}
        onValueChange={(next) => {
          const picked = options.filter((option) => next.value.includes(option.value));
          setAnnotators(picked.map((option) => ({ id: option.value, name: option.label })));
        }}
      >
        <Select.Trigger width="full">
          <Select.ValueText placeholder="Add Participants">
            {(items) => (
              <HStack flexWrap="wrap" gap={1} paddingY={2}>
                {items.map((item) => (
                  <Badge
                    key={item.value}
                    paddingY={1}
                    paddingX={2}
                    borderRadius="full"
                    background="bg.muted"
                  >
                    {item.value.startsWith("user-") ? (
                      <ReviewerAvatar size="2xs" name={item.label} image={item.image} />
                    ) : (
                      <Box padding={1}>
                        <Users size={18} />
                      </Box>
                    )}
                    {item.label}
                    <CloseButton
                      size="2xs"
                      color="fg.muted"
                      aria-label={`Remove ${item.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setAnnotators(
                          annotators.filter((annotator) => annotator.id !== item.value),
                        );
                      }}
                    />
                  </Badge>
                ))}
              </HStack>
            )}
          </Select.ValueText>
        </Select.Trigger>
        <Select.Content maxHeight="300px" portalled={false}>
          <Box
            maxHeight="250px"
            overflowY="auto"
            css={{
              "&::-webkit-scrollbar": { display: "none" },
              msOverflowStyle: "none",
              scrollbarWidth: "none",
            }}
          >
            {left.map((item) => (
              <Select.Item key={item.value} item={item}>
                <VStack align="start">
                  <HStack>
                    {item.value.startsWith("user-") ? (
                      <ReviewerAvatar size="2xs" name={item.label} image={item.image} />
                    ) : (
                      <Box padding={1}>
                        <Users size={18} />
                      </Box>
                    )}
                    <Text>{item.label}</Text>
                  </HStack>
                </VStack>
              </Select.Item>
            ))}
          </Box>
          {left.length === 0 && (
            <Text padding={3} textAlign="center">
              No options
            </Text>
          )}
          <Box
            padding={2}
            position="sticky"
            bottom={0}
            bg="bg.panel"
            borderTop="1px solid"
            borderColor="border.muted"
          >
            <Button
              width="100%"
              colorPalette="blue"
              onClick={onCreateQueue}
              variant="outline"
              size="sm"
            >
              <Plus size={16} /> Add New Queue
            </Button>
          </Box>
        </Select.Content>
      </Select.Root>
      <Spacer />
      <HStack width="full">
        <Spacer />
        <Button
          colorPalette="orange"
          disabled={annotators.length === 0}
          size="sm"
          onClick={onSend}
          loading={isSending}
        >
          Send
        </Button>
      </HStack>
    </VStack>
  );
}
