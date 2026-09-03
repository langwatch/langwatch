import { SpendByTeamBar as EnterpriseSpendByTeamBar } from "../elements/spend-by-team-bar";
import { getHexColorForString } from "@langwatch/design-system/rotating-colors";
export function SpendByTeamBar({
  teams,
}: {
  teams: Array<{
    teamId: string | null;
    teamName: string;
    spendUsd: string;
  }>;
}) {
  return <EnterpriseSpendByTeamBar teams={teams} colorForLabel={getHexColorForString} />;
}
