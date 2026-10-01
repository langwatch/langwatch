import { chakra, Text, VStack } from "@langwatch/design-system/primitives";
import { LangyMark } from "@langwatch/langy-browser-kit";
import { LuArrowRight } from "react-icons/lu";

/**
 * The home's composer slot while a conversation is open: a way back rather than a
 * second place to talk. It hugs its own content; the caller places it in the slot.
 * Spec: specs/home/langy-home.feature
 */
export function ContinueLine({ onContinue }: { onContinue: () => void }) {
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
      _hover={{ color: "fg", borderColor: "orange.emphasized", background: "bg.panel/85" }}
    >
      <LangyMark size={16} />
      <VStack align="start" gap={0.5} minWidth={0}>
        <Text fontFamily="mono" fontSize="13px" color="fg" lineHeight="1.3">
          Continue your conversation
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
          Pick up where you left off
        </Text>
      </VStack>
      <LuArrowRight size={14} aria-hidden />
    </chakra.button>
  );
}
