import { Text } from "@chakra-ui/react";

type FindMatchCounterProps = {
  isSearching: boolean;
  matchCount: number;
  currentIndex: number;
};

export function FindMatchCounter({ isSearching, matchCount, currentIndex }: FindMatchCounterProps) {
  const label = isSearching
    ? "…"
    : matchCount === 0
      ? "No matches"
      : `${currentIndex + 1} of ${matchCount}`;

  return (
    <Text textStyle="2xs" color="fg.subtle" flexShrink={0} whiteSpace="nowrap">
      {label}
    </Text>
  );
}
