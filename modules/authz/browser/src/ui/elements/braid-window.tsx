// Which spans a braid shows: from its start, until its end or with none. Its creation day is not
// here; the project cell names it, so the two dates never sit side by side unlabelled. The window
// is in UTC days (the dialog picks UTC days), so it is drawn in UTC, never a day early or late.

import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { Stack, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

export const BRAID_WINDOW_HEADER = "Spans shown";

export function BraidWindow({
  fromMs,
  fromShowsTime,
  expiresAtMs,
  prefix,
}: {
  fromMs: number;
  /** Another braid on the pair starts the same day, so the time tells them apart. */
  fromShowsTime: boolean;
  expiresAtMs: number | null;
  prefix?: ReactNode;
}) {
  return (
    <Stack gap={0.5}>
      <Text textStyle="sm" data-testid="braid-window-from">
        {prefix}
        From{" "}
        <FormattedDate
          value={fromMs}
          display={fromShowsTime ? "datetime" : "date"}
          timeZone="UTC"
          showZone={fromShowsTime}
        />
      </Text>
      <Text textStyle="xs" color="fg.muted" data-testid="braid-window-until">
        {expiresAtMs === null ? (
          "No end date"
        ) : (
          <>
            Until <FormattedDate value={expiresAtMs} display="date" timeZone="UTC" />
          </>
        )}
      </Text>
    </Stack>
  );
}

/** The project cell's line under the name: when the braid was created. */
export function BraidCreated({ atMs }: { atMs: number }) {
  return (
    <>
      Created <FormattedDate value={atMs} display="date" />
    </>
  );
}
