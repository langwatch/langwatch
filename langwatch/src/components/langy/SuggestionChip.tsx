import { Box, HStack, Text, chakra } from "@chakra-ui/react";
import { ArrowRight, Sparkles } from "lucide-react";
import { useState } from "react";
import type { LangySuggestion } from "~/server/services/langy/suggestion";

interface SuggestionChipProps {
  suggestion: LangySuggestion;
  onAct: () => void;
  onDismiss: () => void;
  onDontShowAgain: () => void;
}

export function SuggestionChip({
  suggestion,
  onAct,
  onDismiss,
  onDontShowAgain,
}: SuggestionChipProps) {
  const [isHover, setIsHover] = useState(false);
  const [isFocus, setIsFocus] = useState(false);
  const secondaryVisible = isHover || isFocus;

  return (
    <Box
      data-testid="langy-suggestion-chip"
      data-suggestion-kind={suggestion.kind}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      onFocus={() => setIsFocus(true)}
      onBlur={() => setIsFocus(false)}
    >
      <chakra.button
        type="button"
        aria-label={`Suggestion: ${suggestion.label}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-suggestion-secondary]")) {
            return;
          }
          onAct();
        }}
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        textAlign="left"
        paddingX={2.5}
        paddingY={1.5}
        borderRadius="md"
        borderWidth="1px"
        borderColor="border.muted"
        background="transparent"
        cursor="pointer"
        transition="border-color 150ms ease, background 150ms ease"
        _hover={{ borderColor: "border.emphasized", background: "bg.subtle" }}
        _focusVisible={{
          borderColor: "border.emphasized",
          background: "bg.subtle",
          outline: "none",
        }}
      >
        <Sparkles size={12} color="var(--chakra-colors-fg-muted)" />
        <Box flex={1} minWidth={0}>
          <Text
            textStyle="xs"
            color="fg"
            fontWeight={500}
            lineHeight="1.35"
            truncate
          >
            {suggestion.label}
          </Text>
          <Text
            textStyle="2xs"
            color="fg.muted"
            lineHeight="1.35"
            truncate
            marginTop="1px"
          >
            {suggestion.rationale}
          </Text>
        </Box>
        <ArrowRight size={12} color="var(--chakra-colors-fg-muted)" />
      </chakra.button>
      <HStack
        gap={3}
        marginTop={1}
        paddingX={2.5}
        opacity={secondaryVisible ? 1 : 0}
        pointerEvents={secondaryVisible ? "auto" : "none"}
        transition="opacity 120ms ease"
      >
        <SecondaryAction
          label="Dismiss"
          onClick={onDismiss}
          ariaLabel={`Dismiss suggestion: ${suggestion.label}`}
        />
        <SecondaryAction
          label="Don't show again"
          onClick={onDontShowAgain}
          ariaLabel={`Don't show suggestions of kind ${suggestion.kind} again`}
        />
      </HStack>
    </Box>
  );
}

function SecondaryAction({
  label,
  onClick,
  ariaLabel,
}: {
  label: string;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <chakra.button
      type="button"
      data-suggestion-secondary
      aria-label={ariaLabel}
      onClick={onClick}
      background="transparent"
      border="none"
      padding={0}
      cursor="pointer"
      color="fg.muted"
      fontSize="11px"
      lineHeight="1.3"
      _hover={{ color: "fg", textDecoration: "underline" }}
      _focusVisible={{ color: "fg", outline: "none", textDecoration: "underline" }}
    >
      {label}
    </chakra.button>
  );
}
