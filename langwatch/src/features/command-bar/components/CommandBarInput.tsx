import { Box, HStack, Input, Spinner } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { MIN_SEARCH_QUERY_LENGTH } from "../constants";

interface CommandBarInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isLoading: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  /**
   * `dialog` is the size the field is in the raised bar. `hero` is the size it
   * is when the home mounts it as the thing the page is for: the same field,
   * set larger, because a field that IS the page cannot be typeset like one
   * row of a dropdown.
   */
  size?: "dialog" | "hero";
}

/**
 * Search input component for the command bar.
 */
export function CommandBarInput({
  inputRef,
  query,
  onChange,
  onKeyDown,
  isLoading,
  onFocus,
  onBlur,
  placeholder = "Where would you like to go?",
  size = "dialog",
}: CommandBarInputProps) {
  const hero = size === "hero";

  return (
    <HStack
      // Fill the field and pin left: HStack's inherited justify defaults to
      // center, which — when this row isn't stretched by its container — floats
      // the icon+input to the middle instead of spanning the field.
      width="full"
      justify="flex-start"
      px={{ base: 4, md: 5 }}
      py={hero ? 4 : 3.5}
      gap={hero ? 3 : 3.5}
    >
      <Box color="fg.subtle" flexShrink={0}>
        <Search size={hero ? 18 : 19} strokeWidth={1.8} />
      </Box>
      <Input
        ref={inputRef}
        value={query}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        border="none"
        outline="none"
        boxShadow="none"
        background="transparent"
        fontSize={hero ? "16px" : "15px"}
        lineHeight="1.5"
        height="auto"
        padding={0}
        flex={1}
        minWidth={0}
        _placeholder={{ color: "fg.subtle" }}
        _focus={{
          boxShadow: "none",
          outline: "none",
          background: "transparent",
        }}
      />
      {isLoading && query.length >= MIN_SEARCH_QUERY_LENGTH && (
        <Spinner size="sm" color="fg.subtle" />
      )}
    </HStack>
  );
}
