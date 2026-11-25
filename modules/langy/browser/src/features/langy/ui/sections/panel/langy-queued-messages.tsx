import { Box, Button, HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { withImageChipsAsNames } from "@langwatch/langy-contract";
import { Pencil, X } from "lucide-react";

import { useLangyStore } from "../../../../../behavior/langy.store.ts";
import { useLangyComposerImages } from "../../../../composer/behavior/langy-composer-images.store.ts";
import {
  discardQueuedMessage,
  type LangyQueuedMessage,
  useLangyMessageQueue,
} from "../../../../composer/behavior/langy-message-queue.store.ts";
import { langyDraftWithQueued } from "../../../../composer/model/langy-follow-up.ts";
import { LangyImageThumb } from "../../../../composer/ui/elements/langy-image-thumb.tsx";

/** Edit puts the message back in the composer, ahead of anything typed there, with its images. */
function editQueued(id: string): void {
  const message = useLangyMessageQueue.getState().takeOne(id);
  if (!message) return;
  const store = useLangyStore.getState();
  store.setDraft(langyDraftWithQueued({ queued: message.text, draft: store.draft }));
  useLangyComposerImages.getState().restore(message.images);
  store.requestComposerFocus();
}

function removeQueued(id: string): void {
  const message = useLangyMessageQueue.getState().takeOne(id);
  if (message) discardQueuedMessage(message);
}

function QueuedBubble({ message }: { message: LangyQueuedMessage }) {
  return (
    <VStack
      align="flex-end"
      gap={1}
      alignSelf="flex-end"
      maxWidth="85%"
      data-testid="langy-queued-message"
    >
      <HStack gap={0.5}>
        <Text textStyle="2xs" color="fg.subtle" fontWeight="medium" marginRight={1}>
          Queued
        </Text>
        <IconButton
          aria-label="Edit queued message"
          size="2xs"
          variant="ghost"
          color="fg.muted"
          onClick={() => editQueued(message.id)}
        >
          <Pencil size={12} />
        </IconButton>
        <IconButton
          aria-label="Remove queued message"
          size="2xs"
          variant="ghost"
          color="fg.muted"
          onClick={() => removeQueued(message.id)}
        >
          <X size={13} />
        </IconButton>
      </HStack>
      {message.images.length > 0 ? (
        <HStack gap={2} flexWrap="wrap" justify="flex-end">
          {message.images.map((image) => (
            <LangyImageThumb
              key={image.key}
              name={image.fileName}
              src={image.previewUrl}
              status="ready"
            />
          ))}
        </HStack>
      ) : null}
      <Box
        paddingX={3}
        paddingY={2}
        background="langy.userBubbleBg"
        color="fg.muted"
        borderWidth="1px"
        borderStyle="dashed"
        borderColor="langy.userBubbleBorder"
        borderRadius="15px"
        borderBottomRightRadius="5px"
        textStyle="sm"
        lineHeight="1.5"
        whiteSpace="pre-wrap"
      >
        {withImageChipsAsNames(message.text)}
      </Box>
    </VStack>
  );
}

/**
 * The messages sent while Langy works, at the end of the thread until the turn ends. After a
 * failed or stopped turn they wait for Send now. Spec: specs/langy-queue-while-busy.feature
 */
export function LangyQueuedMessages({
  live = true,
  paused,
  onSendNow,
}: {
  /** Off while the scrubber shows the past, where nothing is queued. */
  live?: boolean;
  paused: boolean;
  onSendNow: () => void;
}) {
  const conversationId = useLangyStore((s) => s.activeConversationId);
  const all = useLangyMessageQueue((s) => s.messages);
  const queued = all.filter((message) => message.conversationId === conversationId);
  if (!live || queued.length === 0) return null;
  return (
    <VStack align="stretch" gap={2.5}>
      {queued.map((message) => (
        <QueuedBubble key={message.id} message={message} />
      ))}
      {paused ? (
        <HStack alignSelf="flex-end" gap={2}>
          <Text textStyle="xs" color="fg.muted">
            The last turn didn't finish, so {queued.length === 1 ? "this wasn't" : "these weren't"}{" "}
            sent.
          </Text>
          <Button size="xs" colorPalette="orange" onClick={onSendNow}>
            Send now
          </Button>
        </HStack>
      ) : null}
    </VStack>
  );
}
