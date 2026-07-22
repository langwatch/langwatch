import { Box, HStack, Input, Spinner } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { MIN_SEARCH_QUERY_LENGTH } from "../constants";

interface CommandBarInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isLoading: boolean;
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
}: CommandBarInputProps) {
  return (
    <HStack px={{ base: 4, md: 5 }} py={3.5} gap={3.5}>
      <Box color="fg.subtle" flexShrink={0}>
        <Search size={19} strokeWidth={1.8} />
      </Box>
      <Input
        ref={inputRef}
        value={query}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Where would you like to go?"
        border="none"
        outline="none"
        boxShadow="none"
        background="transparent"
        fontSize="15px"
        lineHeight="1.5"
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
