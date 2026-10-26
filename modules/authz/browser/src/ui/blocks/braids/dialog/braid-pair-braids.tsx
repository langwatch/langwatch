// What the picked reader already sees from this project: each live braid on the pair, its
// condition and its window, above the condition being written.

import type { AuthzBraid } from "@langwatch/authz-contract";
import { Card } from "@langwatch/design-system/card";
import { Stack, Text } from "@langwatch/design-system/primitives";
import { format } from "@langwatch/time";

import { pairBraidsPhrase } from "../../../../model/braids/braid-draft.ts";
import { BraidCondition } from "../../../elements/braid-condition.tsx";

const day = (ms: number) => format(ms, "d MMM yyyy");

export function BraidPairBraids({
  readerName,
  ownerName,
  braids,
}: {
  readerName: string;
  ownerName: string;
  braids: readonly AuthzBraid[];
}) {
  if (braids.length === 0) return null;
  return (
    <Card variant="frame" padding="sm" data-testid="braid-pair-braids">
      <Stack gap={2}>
        <Text fontSize="sm" fontWeight="medium">
          {pairBraidsPhrase({ readerName, ownerName, count: braids.length })}
        </Text>
        {braids.map((braid) => (
          <Stack key={braid.braidId} gap={1} data-testid="braid-pair-braid">
            <BraidCondition where={braid.where} />
            <Text fontSize="xs" color="fg.muted">
              {`From ${day(braid.fromMs)} · ${
                braid.expiresAtMs === null ? "No end date" : `Until ${day(braid.expiresAtMs)}`
              }`}
            </Text>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}
