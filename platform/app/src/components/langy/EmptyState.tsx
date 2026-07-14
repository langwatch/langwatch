import { Button, Circle, HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import {
  AI_BG_HOVER,
  AI_BG_SUBTLE,
  AI_BORDER,
  AI_SHADOW_SOFT,
  GradientSparkle,
} from "~/features/traces-v2/components/ai/aiBrandVisuals";

const SUGGESTION_CHIPS = [
  "Summarize my experiment",
  "Find failing traces",
  "Suggest an evaluator",
  "Compare two runs",
  "Explain a low score",
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <VStack
      gap={0}
      align="center"
      justify="center"
      flex={1}
      paddingX={6}
      paddingY={8}
      height="full"
    >
      <Circle
        size="64px"
        bg={AI_BG_SUBTLE}
        borderWidth="1px"
        borderStyle="solid"
        borderColor={AI_BORDER}
        boxShadow={AI_SHADOW_SOFT}
      >
        <GradientSparkle size={28} />
      </Circle>
      <Text
        textStyle="lg"
        fontWeight="600"
        letterSpacing="-0.3px"
        color="fg"
        textAlign="center"
        marginTop={4}
      >
        How can I help?
      </Text>
      <Text
        textStyle="sm"
        color="fg.muted"
        lineHeight="1.5"
        textAlign="center"
        maxWidth="280px"
        marginTop={2}
        marginBottom={5}
      >
        Ask in plain language. I&apos;ll read your traces and evals, then
        propose changes you can apply.
      </Text>
      <HStack gap={1.5} flexWrap="wrap" justify="center" maxWidth="320px">
        {SUGGESTION_CHIPS.map((chip) => (
          <Chip key={chip} onClick={() => onPick(chip)}>
            {chip}
          </Chip>
        ))}
      </HStack>
    </VStack>
  );
}

function Chip({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={onClick}
      borderRadius="full"
      fontWeight="500"
      color="fg"
      borderColor="border.emphasized"
      bg="bg.subtle"
      _hover={{
        bg: AI_BG_HOVER,
        borderColor: AI_BORDER,
        boxShadow: "0 1px 2px rgba(168, 85, 247, 0.12)",
      }}
      whiteSpace="nowrap"
    >
      {children}
    </Button>
  );
}
