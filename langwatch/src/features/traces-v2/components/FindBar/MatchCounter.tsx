import { Text } from "@chakra-ui/react";

interface MatchCounterProps {
  isSearching: boolean;
  matchCount: number;
  currentIndex: number;
}

export function MatchCounter({
  isSearching,
  matchCount,
  currentIndex,
}: MatchCounterProps) {
  const label = isSearching
    ? "…"
    : matchCount === 0
      ? "No matches"
      : `${currentIndex + 1} of ${matchCount}`;

  return (
    <Text
      textStyle="2xs"
      color="fg.subtle"
      fontFamily="mono"
      flexShrink={0}
      whiteSpace="nowrap"
    >
      {label}
    </Text>
  );
}
