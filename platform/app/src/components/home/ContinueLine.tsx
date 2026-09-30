import { chakra, Text, VStack } from "@chakra-ui/react";
import { LuArrowRight } from "react-icons/lu";
import { LangyMark } from "~/features/langy/components/LangyMark";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import type { HomeDevState } from "./dev/homeDevState";

/** Puts the cursor in the panel's composer, once the panel is open. */
export function focusPanelComposer(): void {
  document
    .querySelector<HTMLElement>('[data-langy-composer="panel"]')
    ?.querySelector("textarea")
    ?.focus();
}

/**
 * Whether the home's field stands down, and what takes its place.
 *
 * Once a conversation is under way the field has nothing to start: a question
 * handed to Langy is on its way, or the panel is open on a conversation. The
 * field starts conversations and the panel's composer continues them; offered
 * together, a line typed on the home while the panel was open on a
 * conversation went into a new one. The dev states preview both looks.
 */
export function useConversationOpen(devState: HomeDevState | null): {
  conversationOpen: boolean;
  stalled: boolean;
  continueInLangy: () => void;
} {
  const isOpen = useLangyStore((s) => s.isOpen);
  const openPanel = useLangyStore((s) => s.openPanel);
  const activeConversationId = useLangyStore((s) => s.activeConversationId);
  const pendingPrompt = useLangyStore((s) => s.pendingPrompt);
  const conversationOpen =
    devState === "after-turn" ||
    devState === "stalled" ||
    !!pendingPrompt ||
    (isOpen && !!activeConversationId);
  return {
    conversationOpen,
    stalled: devState === "stalled",
    continueInLangy: () => {
      openPanel();
      focusPanelComposer();
    },
  };
}

/**
 * The home's composer slot while a conversation is open.
 *
 * It offers a way back rather than a second place to talk: clicking it focuses
 * the conversation that already exists, and never starts a new one. The hero
 * and the lantern both show it in the space their field held, so the page
 * never offers two composers on one conversation.
 *
 * It takes its slot's HEIGHT but not its width. A field is full-bleed because
 * an input wants the room; a resume control that inherited that stretched one
 * short sentence across the whole block and read as an empty container with
 * some text stranded at one end. It hugs its own content instead, and the
 * caller places it.
 *
 * Spec: specs/home/langy-home.feature, specs/home/langy-home-morph.feature
 */
export function ContinueLine({
  stalled,
  onContinue,
}: {
  stalled: boolean;
  onContinue: () => void;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onContinue}
      height="full"
      maxWidth="full"
      display="flex"
      alignItems="center"
      gap={2.5}
      textAlign="left"
      paddingLeft={3.5}
      paddingRight={4}
      borderRadius="18px"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      background="bg.panel/70"
      backdropFilter="blur(8px)"
      cursor="pointer"
      color="fg.muted"
      transition="color 130ms ease, border-color 130ms ease, background 130ms ease"
      _hover={{
        color: "fg",
        borderColor: "orange.emphasized",
        background: "bg.panel/85",
      }}
    >
      <LangyMark size={16} />
      <VStack align="start" gap={0.5} minWidth={0}>
        <Text fontFamily="mono" fontSize="13px" color="fg" lineHeight="1.3">
          {stalled ? "Langy is still working" : "Continue your conversation"}
        </Text>
        <Text
          fontSize="xs"
          color="fg.subtle"
          lineHeight="1.3"
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
          maxWidth="full"
        >
          {stalled ? "Its answer is on the way" : "Pick up where you left off"}
        </Text>
      </VStack>
      <LuArrowRight size={14} aria-hidden />
    </chakra.button>
  );
}
