import { Box, HStack, Input, Spinner, Text } from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { Search, Sparkles } from "lucide-react";
import { aiBrandPalette } from "~/features/traces-v2/components/ai/aiBrandPalette";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { MIN_SEARCH_QUERY_LENGTH } from "../constants";

interface CommandBarInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isLoading: boolean;
  askLangyMode?: boolean;
}

/**
 * Search input component for the command bar.
 *
 * In Ask Langy mode the leading search icon is swapped for a gradient
 * "Ask Langy" chip (Chrome-omnibox style — like "Search Gmail" / "Tab
 * to search Gmail"), signaling that Enter sends the query into Langy
 * instead of navigating. The input itself stays flat — no hover/focus
 * accent — so the chip carries the whole brand moment.
 */
export function CommandBarInput({
  inputRef,
  query,
  onChange,
  onKeyDown,
  isLoading,
  askLangyMode = false,
}: CommandBarInputProps) {
  const reduceMotion = useReducedMotion();

  return (
    <HStack px={4} py={3} gap={3}>
      {askLangyMode ? (
        <Box
          position="relative"
          overflow="hidden"
          borderRadius="full"
          flexShrink={0}
          boxShadow="0 1px 4px rgba(168,85,247,0.30), 0 0 0 1px rgba(255,95,31,0.12)"
          _dark={{ boxShadow: "0 1px 4px rgba(168,85,247,0.20)" }}
        >
          <Box
            position="absolute"
            inset={0}
            zIndex={0}
            pointerEvents="none"
            _dark={{ opacity: 0.75 }}
          >
            <MeshGradient
              colors={aiBrandPalette}
              distortion={0.5}
              swirl={0.5}
              grainMixer={0}
              grainOverlay={0}
              speed={reduceMotion ? 0 : 0.4}
              scale={1.5}
              style={{ width: "100%", height: "100%" }}
            />
          </Box>
          <HStack
            gap={1.5}
            px={3}
            py={1.5}
            position="relative"
            zIndex={1}
            color="white"
          >
            <Sparkles size={13} />
            <Text fontSize="12px" fontWeight="600" letterSpacing="0.01em">
              Ask Langy
            </Text>
          </HStack>
        </Box>
      ) : (
        <Box color="fg.subtle" flexShrink={0}>
          <Search size={20} />
        </Box>
      )}
      <Input
        ref={inputRef}
        value={query}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={
          askLangyMode
            ? "Ask Langy anything… (Enter to send)"
            : "Where would you like to go?"
        }
        border="none"
        outline="none"
        boxShadow="none"
        background="transparent"
        fontSize="15px"
        flex={1}
        color={askLangyMode ? "purple.fg" : undefined}
        _placeholder={{
          color: askLangyMode ? "purple.fg" : "fg.subtle",
          opacity: askLangyMode ? 0.7 : 1,
        }}
        _focus={{
          boxShadow: "none",
          outline: "none",
          background: "transparent",
        }}
        _hover={{ background: "transparent" }}
      />
      {isLoading && query.length >= MIN_SEARCH_QUERY_LENGTH && (
        <Spinner size="sm" color="fg.subtle" />
      )}
    </HStack>
  );
}
