// What the picked reader already sees from this project: a summary with Show, opening to each live
// braid on the pair with its condition and window. The preview sets it as a note or its headline.

import type { AuthzBraid } from "@langwatch/authz-contract";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { Button, Stack, Text } from "@langwatch/design-system/primitives";
import { type ReactNode, useState } from "react";

import { BraidCondition } from "../../../elements/braid-condition.tsx";

export function BraidPairBraids({
  braids,
  summary,
}: {
  braids: readonly AuthzBraid[];
  /** What the braids mean for this one, said above Show. */
  summary: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (braids.length === 0) return null;
  return (
    <Stack gap={2} align="start" data-testid="braid-pair-braids">
      {summary}
      <Button
        size="xs"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="braid-pair-braids-toggle"
      >
        {open ? "Hide" : "Show"}
      </Button>
      {open
        ? braids.map((braid) => (
            <Stack key={braid.braidId} gap={1} data-testid="braid-pair-braid">
              <BraidCondition where={braid.where} />
              <Text textStyle="caption" color="fg.muted">
                From <FormattedDate value={braid.fromMs} display="date" timeZone="UTC" /> ·{" "}
                {braid.expiresAtMs === null ? (
                  "No end date"
                ) : (
                  <>
                    Until <FormattedDate value={braid.expiresAtMs} display="date" timeZone="UTC" />
                  </>
                )}
              </Text>
            </Stack>
          ))
        : null}
    </Stack>
  );
}
