import { Box, Button, HStack, Text, Textarea, VStack } from "@chakra-ui/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useLangyFeedback } from "../data/useLangyFeedback";
import {
  type LangyFeedbackSentiment,
  markFeedbackAsked,
} from "../logic/langyFeedbackDirective";

/** Copy tailored to the moment Langy classified via its feedback directive. */
function promptFor(sentiment?: LangyFeedbackSentiment): string {
  switch (sentiment) {
    case "delighted":
      return "Did that land well?";
    case "frustrated":
      return "That looked rough — how did Langy do?";
    default:
      return "How's Langy doing?";
  }
}

/**
 * Modern, low-chrome in-agent feedback under a completed assistant message.
 *
 * A quiet thumbs up / down that only asserts itself on hover. Thumbs-up records
 * silently. Thumbs-down expands a small "what went wrong?" prompt AND — since a
 * down usually means friction — offers a consent toggle to share the full
 * conversation so we can debug it (routed into LangWatch itself as a feedback
 * event on the conversation's trace). Nothing is forced: the comment and the
 * consent are both optional. Once submitted it collapses to a calm
 * acknowledgement.
 */
export function LangyFeedback({
  conversationId,
  messageId,
  traceId,
  sentiment,
}: {
  conversationId?: string;
  messageId?: string;
  traceId?: string;
  /** The moment Langy classified this as, via its feedback directive. */
  sentiment?: LangyFeedbackSentiment;
}) {
  const { submit } = useLangyFeedback();
  const [state, setState] = useState<"idle" | "expanded" | "done">("idle");
  const [comment, setComment] = useState("");
  const [shareConsent, setShareConsent] = useState(false);

  const sendUp = () => {
    submit({
      conversationId,
      messageId,
      traceId,
      rating: "up",
      sentiment: "delighted",
    });
    markFeedbackAsked();
    setState("done");
  };

  const sendDown = () => {
    submit({
      conversationId,
      messageId,
      traceId,
      rating: "down",
      sentiment: "frustrated",
      comment: comment.trim() || undefined,
      shareConversationConsent: shareConsent,
    });
    markFeedbackAsked();
    setState("done");
  };

  if (state === "done") {
    return (
      <Text textStyle="2xs" color="fg.subtle" alignSelf="flex-start">
        Thanks — that helps Langy get better.
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={2} alignSelf="flex-start" maxWidth="100%">
      <HStack
        gap={1}
        opacity={0.55}
        _hover={{ opacity: 1 }}
        transition="opacity 150ms ease"
      >
        <Text textStyle="2xs" color="fg.muted" marginRight={1}>
          {promptFor(sentiment)}
        </Text>
        <Tooltip content="Good answer" openDelay={200}>
          <Button
            aria-label="Good answer"
            size="2xs"
            variant="ghost"
            color="fg.muted"
            _hover={{ color: "orange.solid", bg: "bg.subtle" }}
            onClick={sendUp}
          >
            <ThumbsUp size={13} />
          </Button>
        </Tooltip>
        <Tooltip content="Needs work" openDelay={200}>
          <Button
            aria-label="Needs work"
            size="2xs"
            variant="ghost"
            color="fg.muted"
            _hover={{ color: "fg", bg: "bg.subtle" }}
            onClick={() =>
              setState((s) => (s === "expanded" ? "idle" : "expanded"))
            }
          >
            <ThumbsDown size={13} />
          </Button>
        </Tooltip>
      </HStack>

      {state === "expanded" ? (
        <VStack
          align="stretch"
          gap={2}
          padding={3}
          borderRadius="lg"
          borderWidth="1px"
          borderStyle="solid"
          borderColor="border.emphasized"
          background="bg.subtle"
        >
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What went wrong? (optional)"
            rows={2}
            autoresize
            textStyle="xs"
            maxHeight="120px"
          />
          <HStack
            as="label"
            gap={2}
            cursor="pointer"
            onClick={() => setShareConsent((v) => !v)}
          >
            <Box
              width="14px"
              height="14px"
              borderRadius="sm"
              borderWidth="1px"
              borderStyle="solid"
              borderColor={shareConsent ? "orange.solid" : "border.emphasized"}
              background={shareConsent ? "orange.solid" : "transparent"}
              flexShrink={0}
            />
            <Text textStyle="2xs" color="fg.muted" lineHeight="1.35">
              Let the LangWatch team view this conversation to debug it.
            </Text>
          </HStack>
          <HStack justify="flex-end">
            <Button
              size="xs"
              variant="ghost"
              color="fg.muted"
              onClick={() => setState("idle")}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              variant="outline"
              borderColor="orange.solid"
              color="orange.solid"
              onClick={sendDown}
            >
              Send feedback
            </Button>
          </HStack>
        </VStack>
      ) : null}
    </VStack>
  );
}
