import { Box, Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";

export type SpendByTeamBarTeam = {
  teamId: string | null;
  teamName: string;
  spendUsd: string;
};

/**
 * Enterprise spend-attribution presentation. The host supplies its colour
 * palette so this package remains independent of application theming.
 */
export function SpendByTeamBar({
  teams,
  colorForLabel,
}: {
  teams: SpendByTeamBarTeam[];
  colorForLabel: (label: string) => string;
}) {
  const total = teams.reduce((sum, team) => sum + Number(team.spendUsd), 0);
  if (total === 0 || teams.length === 0) return null;

  return (
    <VStack align="stretch" gap={3}>
      <HStack>
        <Heading size="sm">Team share of spend</Heading>
        <Spacer />
        <Text fontSize="xs" color="fg.muted">
          {formatUsd(total)} total · last 30 days
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
        {teams.map((team) => {
          const percentage = (Number(team.spendUsd) / total) * 100;
          const color = colorForLabel(team.teamName);
          return (
            <Box
              key={team.teamId ?? team.teamName}
              width={`${percentage}%`}
              backgroundColor={color}
              opacity={0.9}
              title={`${team.teamName} — ${formatUsd(Number(team.spendUsd))} (${percentage.toFixed(1)}%)`}
              _hover={{ opacity: 1 }}
            />
          );
        })}
      </Box>
      <HStack wrap="wrap" gap={3} fontSize="xs">
        {teams.map((team) => {
          const percentage = (Number(team.spendUsd) / total) * 100;
          const color = colorForLabel(team.teamName);
          return (
            <HStack key={team.teamId ?? team.teamName} gap={1.5}>
              <Box width="10px" height="10px" borderRadius="sm" backgroundColor={color} />
              <Text color="fg" fontWeight="medium">
                {team.teamName}
              </Text>
              <Text color="fg.muted">{percentage.toFixed(1)}%</Text>
            </HStack>
          );
        })}
      </HStack>
    </VStack>
  );
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
