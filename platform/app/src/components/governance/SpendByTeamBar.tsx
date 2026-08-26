import { SpendByTeamBar as EnterpriseSpendByTeamBar } from "@langwatch/enterprise-governance-web";

import { getHexColorForString } from "~/utils/rotatingColors";

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
