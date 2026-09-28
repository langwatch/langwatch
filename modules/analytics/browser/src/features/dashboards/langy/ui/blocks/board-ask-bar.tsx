/**
 * The ask bar at the top of every board, after the reference: a pill with a
 * soft gradient edge, a sparkle, the purple prompt and an "Ask" chip. Pressing
 * Ask or Enter hands the typed question on; an empty bar asks nothing.
 */

import { Box, chakra, HStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";

/** The reference's hover ring: purple at a tenth, outside the gradient edge. */
const HALO = "0 0 0 4px color-mix(in srgb, var(--chakra-colors-purple-500) 10%, transparent)";

export function BoardAskBar({ onAsk }: { onAsk: (question: string) => void }) {
  const [question, setQuestion] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    onAsk(question);
    setQuestion("");
  };

  return (
    <Box
      marginX="auto"
      marginBottom={4}
      maxWidth="640px"
      width="full"
      borderRadius="full"
      padding="1px"
      bgGradient="to-r"
      gradientFrom="purple.400/60"
      gradientVia="pink.400/40"
      gradientTo="teal.400/50"
      transition="box-shadow 0.15s"
      _hover={{ boxShadow: HALO }}
      _focusWithin={{ boxShadow: HALO }}
    >
      <chakra.form aria-label="Ask Langy" onSubmit={submit}>
        <HStack
          height="40px"
          gap={2.5}
          paddingX={4}
          borderRadius="full"
          background="bg.panel"
          cursor="text"
        >
          <Box as="span" flexShrink={0} color="purple.600" display="flex">
            <Sparkles size={15} aria-hidden />
          </Box>
          <chakra.input
            aria-label="Ask Langy about this dashboard"
            placeholder="What would you like to know?"
            value={question}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            flex={1}
            minWidth={0}
            height="full"
            background="transparent"
            border="none"
            outline="none"
            fontSize="sm"
            fontWeight="medium"
            color="purple.600"
            _placeholder={{ color: "purple.600", opacity: 1 }}
          />
          <chakra.button
            type="submit"
            flexShrink={0}
            display="flex"
            alignItems="center"
            gap={1}
            borderRadius="full"
            paddingX={2}
            paddingY={0.5}
            background="purple.50"
            color="purple.600"
            fontSize="11px"
            fontWeight="medium"
            cursor="pointer"
            _hover={{ background: "purple.100" }}
          >
            Ask
          </chakra.button>
        </HStack>
      </chakra.form>
    </Box>
  );
}
