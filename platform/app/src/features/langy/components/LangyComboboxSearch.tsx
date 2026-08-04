import { Box, Combobox, HStack } from "@chakra-ui/react";
import { Search } from "lucide-react";

/**
 * Shared search chrome for Langy's compact listboxes.
 *
 * The input is part of the popup, not a form dropped inside it: one quiet
 * inset surface, a search glyph, a neutral focus treatment, and a hairline
 * separating it from the results. Chat history and model selection should not
 * teach two different search patterns two inches apart.
 */
export function LangyComboboxSearch({ placeholder }: { placeholder: string }) {
  return (
    <Box
      position="sticky"
      top={0}
      zIndex={1}
      background="bg.panel/96"
      padding={1.5}
      borderBottomWidth="1px"
      borderColor="border.muted"
    >
      <HStack
        height="34px"
        gap={2}
        paddingX={2.5}
        borderRadius="9px"
        borderWidth="1px"
        borderColor="border.muted"
        background="bg.subtle/72"
        color="fg.subtle"
        transition="background 130ms ease, border-color 130ms ease, box-shadow 130ms ease"
        _focusWithin={{
          background: "bg.surface/86",
          borderColor: "border.emphasized",
          boxShadow: "0 0 0 2px var(--chakra-colors-bg-muted)",
          color: "fg.muted",
        }}
      >
        <Box flexShrink={0} display="grid" placeItems="center" aria-hidden>
          <Search size={13} />
        </Box>
        <Combobox.Input
          autoFocus
          placeholder={placeholder}
          height="full"
          minWidth={0}
          flex={1}
          padding={0}
          border={0}
          outline="none"
          background="transparent"
          fontSize="13px"
          color="fg"
          _placeholder={{ color: "fg.subtle" }}
          _focusVisible={{ outline: "none" }}
        />
      </HStack>
    </Box>
  );
}
