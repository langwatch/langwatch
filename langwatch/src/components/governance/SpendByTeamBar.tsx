import { Box, HStack, Heading, Spacer, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";

import { getHexColorForString } from "~/utils/rotatingColors";

/**
 * Single horizontal stacked bar — each segment proportional to that
 * team's share of total organization spend in the window. Stable
 * colors via name-hash so a team paints the same hue everywhere.
 *
 * Answers the admin's "who drives the cost across the company" at
 * a glance, in one row of pixels. Works on the data we already have
 * in `spendByTeam` (no time-series dependency on Sergey's
 * `spendOverTime` endpoint), so it ships in Phase B-1 and gives the
 * dashboard immediate visual depth before B-2's time-series chart
 * lands.
 */
export function SpendByTeamBar({
  teams,
}: {
  teams: Array<{
    teamId: string | null;
    teamName: string;
    spendUsd: number;
  }>;
}) {
  const total = teams.reduce((sum, t) => sum + t.spendUsd, 0);
  if (total === 0 || teams.length === 0) {
    return null;
  }

  return (
    <VStack align="stretch" gap={3}>
      <HStack>
        <Heading size="sm">Team share of spend</Heading>
        <Spacer />
        <Text fontSize="xs" color="fg.muted">
          {numeral(total).format("$0,0.00")} total · last 30 days
        </Text>
      </HStack>
      <Box
        display="flex"
        height="32px"
        borderRadius="md"
        overflow="hidden"
        borderWidth="1px"
        borderColor="border.subtle"
      >
        {teams.map((t) => {
          const pct = (t.spendUsd / total) * 100;
          const color = getHexColorForString(t.teamName);
          return (
            <Box
              key={t.teamId ?? t.teamName}
              width={`${pct}%`}
              backgroundColor={color}
              opacity={0.9}
              title={`${t.teamName} — ${numeral(t.spendUsd).format(
                "$0,0.00",
              )} (${pct.toFixed(1)}%)`}
              _hover={{ opacity: 1 }}
            />
          );
        })}
      </Box>
      <HStack wrap="wrap" gap={3} fontSize="xs">
        {teams.map((t) => {
          const pct = (t.spendUsd / total) * 100;
          const color = getHexColorForString(t.teamName);
          return (
            <HStack key={t.teamId ?? t.teamName} gap={1.5}>
              <Box
                width="10px"
                height="10px"
                borderRadius="sm"
                backgroundColor={color}
              />
              <Text color="fg" fontWeight="medium">
                {t.teamName}
              </Text>
              <Text color="fg.muted">{pct.toFixed(1)}%</Text>
            </HStack>
          );
        })}
      </HStack>
    </VStack>
  );
}
