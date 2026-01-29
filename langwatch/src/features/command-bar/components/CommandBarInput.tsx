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
    <HStack px={4} py={3} gap={3}>
      <Box color="fg.muted" flexShrink={0}>
        <Search size={20} />
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
        flex={1}
        _placeholder={{ color: "fg.muted" }}
        _focus={{
          boxShadow: "none",
          outline: "none",
          background: "transparent",
        }}
      />
      {isLoading && query.length >= MIN_SEARCH_QUERY_LENGTH && (
        <Spinner size="sm" color="fg.muted" />
      )}
    </HStack>
  );
}
