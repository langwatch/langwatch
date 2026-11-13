// What the picked reader already sees from this project: one quiet line in the preview, opening to
// each live braid on the pair with its condition and window.

import type { AuthzBraid } from "@langwatch/authz-contract";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { Button, Stack, Text } from "@langwatch/design-system/primitives";
import { type ReactNode, useState } from "react";

import { BraidCondition } from "../../../elements/braid-condition.tsx";

export function BraidPairBraids({
  readerName,
  braids,
  summary,
}: {
  readerName: string;
  braids: readonly AuthzBraid[];
  /** Said in place of the count, such as what this braid adds to them. */
  summary?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (braids.length === 0) return null;
  const count = braids.length;
  return (
    <Stack gap={1.5} data-testid="braid-pair-braids">
      <Text>
        {summary ?? `${count} other ${count === 1 ? "braid" : "braids"} into ${readerName}`}
        <Text as="span" whiteSpace="nowrap">
          <Text as="span" aria-hidden>
            {" · "}
          </Text>
          <Button
            variant="plain"
            size="xs"
            display="inline"
            height="auto"
            minWidth={0}
            padding={0}
            textStyle="bodySm"
            verticalAlign="baseline"
            color="fg"
            textDecoration="underline"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            data-testid="braid-pair-braids-toggle"
          >
            {open ? "Hide" : "Show"}
          </Button>
        </Text>
      </Text>
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
