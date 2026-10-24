import { Box, HStack, Input, Text } from "@langwatch/design-system/primitives";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * The inline prompt Cmd/Ctrl+I opens over the code editor: one line to Langy. Enter asks,
 * Escape closes without asking.
 */
export function CodeAskPrompt({
  onAsk,
  onClose,
}: {
  onAsk: (instruction: string) => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // The reader opened the prompt with a keystroke or a click, so focus follows them into it.
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <Box
      position="absolute"
      top={3}
      right={6}
      zIndex={10}
      width="440px"
      maxWidth="calc(100% - 48px)"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      boxShadow="lg"
      padding={2}
      data-testid="code-ask-prompt"
    >
      <HStack gap={2}>
        <Box color="fg.muted" flexShrink={0}>
          <Sparkles size={16} />
        </Box>
        <Input
          ref={field}
          size="sm"
          variant="flushed"
          aria-label="Describe what this code should do"
          placeholder="Describe what this code should do"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onClose();
              return;
            }
            if (event.key === "Enter" && instruction.trim()) {
              event.preventDefault();
              onAsk(instruction.trim());
            }
          }}
        />
      </HStack>
      <Text textStyle="xs" color="fg.muted" paddingTop={1} paddingLeft={6}>
        Langy proposes a change for you to review. Nothing is saved until you save.
      </Text>
    </Box>
  );
}
