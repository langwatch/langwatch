import { Box, chakra, HStack, Input, Text } from "@chakra-ui/react";
import { CornerDownLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  LangyMark,
  LangyMarkGradientDefs,
} from "~/features/langy/components/LangyMark";

const LANGY_INPUT_RADIUS = "18px";
const COMMAND_BAR_LANGY_GRADIENT_ID = "command-bar-langy-mark-gradient";

/**
 * The focused "Ask Langy" state of the command bar.
 *
 * This deliberately borrows only Langy's quiet composer signals: its own mark,
 * the restrained hairline sheen, and the orange focus ring. It does not repaint
 * the global command palette with a generic sparkle/AI gradient treatment.
 */
export function CommandBarLangyMode({
  query,
  onQueryChange,
  onSubmit,
  onExit,
  exiting,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  /** Enter — hand the question to Langy. */
  onSubmit: () => void;
  /** Escape / Backspace-on-empty — return to normal command mode. */
  onExit: () => void;
  /** The panel handoff has started; keep this field inert until it closes. */
  exiting: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Take focus on entry and put the cursor after the query carried over from
  // normal command search.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (exiting) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
      return;
    }
    // Escape stays inside the mode switch. It must not bubble to the provider's
    // global Escape handler, which would close the entire command bar.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onExit();
      return;
    }
    if (event.key === "Backspace" && query.length === 0) {
      event.preventDefault();
      onExit();
    }
  };

  return (
    <Box
      className="langy-root"
      data-langy-command-mode="true"
      background="transparent"
    >
      <LangyMarkGradientDefs id={COMMAND_BAR_LANGY_GRADIENT_ID} />

      <Box px={{ base: 3, md: 4 }} py={{ base: 3, md: 3.5 }}>
        <Box position="relative" borderRadius={LANGY_INPUT_RADIUS}>
          {/* This is the same restrained, masked hairline used by the panel's
              empty composer. Reduced-motion behavior comes from its shared CSS. */}
          <Box className="langy-composer-sheen" aria-hidden />

          <HStack
            gap={3}
            minHeight="56px"
            paddingX={3.5}
            borderWidth="1px"
            borderStyle="solid"
            borderColor={focused ? "orange.emphasized" : "border.emphasized"}
            borderRadius={LANGY_INPUT_RADIUS}
            background="bg.subtle"
            boxShadow={
              focused
                ? "0 0 0 4px var(--chakra-colors-orange-subtle)"
                : "0 1px 2px rgba(20, 20, 23, 0.04)"
            }
            transition="border-color 150ms ease, box-shadow 150ms ease"
          >
            <Box
              flexShrink={0}
              display="grid"
              placeItems="center"
              width="24px"
              aria-hidden
            >
              <LangyMark size={23} gradientId={COMMAND_BAR_LANGY_GRADIENT_ID} />
            </Box>

            <Input
              ref={inputRef}
              aria-label="Ask Langy"
              aria-busy={exiting}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Langy about this project…"
              readOnly={exiting}
              autoComplete="off"
              border="none"
              outline="none"
              boxShadow="none"
              background="transparent"
              fontSize="15px"
              lineHeight="1.5"
              flex={1}
              minWidth={0}
              color="fg"
              _placeholder={{ color: "fg.subtle" }}
              _focus={{
                boxShadow: "none",
                outline: "none",
                background: "transparent",
              }}
              _focusVisible={{
                boxShadow: "none",
                outline: "none",
              }}
            />

            <Text
              flexShrink={0}
              fontSize="11px"
              fontWeight="semibold"
              color="fg.muted"
              letterSpacing="0.02em"
            >
              Langy
            </Text>
          </HStack>
        </Box>
      </Box>

      <HStack
        justify="space-between"
        gap={4}
        px={{ base: 4, md: 5 }}
        py={2.5}
        borderTop="1px solid"
        borderColor="border.subtle"
        color="fg.muted"
        fontSize="12px"
      >
        <Text>Ask about the project in plain language</Text>
        <HStack gap={3} flexShrink={0}>
          <HStack gap={1}>
            <KeyHint>
              <CornerDownLeft size={11} />
            </KeyHint>
            <Text>Ask</Text>
          </HStack>
          <HStack gap={1}>
            <KeyHint>Esc</KeyHint>
            <Text>Back</Text>
          </HStack>
        </HStack>
      </HStack>
    </Box>
  );
}

function KeyHint({ children }: { children: React.ReactNode }) {
  return (
    <chakra.kbd
      minWidth="20px"
      height="20px"
      paddingX="4px"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      fontFamily="mono"
      fontSize="10px"
      lineHeight="1"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="5px"
      background="bg.surface"
      color="fg.muted"
    >
      {children}
    </chakra.kbd>
  );
}
