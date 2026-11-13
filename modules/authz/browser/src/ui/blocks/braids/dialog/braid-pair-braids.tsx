// What the picked reader already sees from this project: one quiet line, opening to each live
// braid on the pair with its condition and window.

import type { AuthzBraid } from "@langwatch/authz-contract";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { Button, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { useState } from "react";

import { BraidCondition } from "../../../elements/braid-condition.tsx";

export function BraidPairBraids({
  readerName,
  braids,
}: {
  readerName: string;
  ownerName: string;
  braids: readonly AuthzBraid[];
}) {
  const [open, setOpen] = useState(false);
  if (braids.length === 0) return null;
  const count = braids.length;
  return (
    <Stack gap={1.5} data-testid="braid-pair-braids">
      <HStack gap={1} textStyle="xs" color="fg.muted">
        <Text>{`${count} other ${count === 1 ? "braid" : "braids"} into ${readerName}`}</Text>
        <Text aria-hidden>·</Text>
        <Button
          variant="plain"
          size="xs"
          height="auto"
          minWidth={0}
          padding={0}
          color="fg.muted"
          textDecoration="underline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-testid="braid-pair-braids-toggle"
        >
          {open ? "Hide" : "Show"}
        </Button>
      </HStack>
      {open
        ? braids.map((braid) => (
            <Stack key={braid.braidId} gap={0.5} data-testid="braid-pair-braid">
              <BraidCondition where={braid.where} />
              <Text textStyle="xs" color="fg.muted">
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
