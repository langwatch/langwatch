// Data from (may reach back before today) and when the reader stops seeing the spans.

import { Field, Grid, Input, Stack } from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";

import { type BraidEnds, dayInputMs, dayInputValue } from "../../../../model/braids/braid-draft.ts";

export type BraidWindowFieldsProps = {
  fromMs: number;
  ends: BraidEnds;
  nowMs: number;
  ownerName: string;
  readerName: string;
  onFrom: (fromMs: number) => void;
  onEnds: (ends: BraidEnds) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function endsValue(ends: BraidEnds): string {
  if (ends.kind === "days") return String(ends.days);
  return ends.kind;
}

export function BraidWindowFields(props: BraidWindowFieldsProps) {
  const pick = (value: string) => {
    if (value === "30" || value === "90")
      props.onEnds({ kind: "days", days: value === "30" ? 30 : 90 });
    else if (value === "date") props.onEnds({ kind: "date", dateMs: props.nowMs + 180 * DAY_MS });
    else props.onEnds({ kind: "never" });
  };
  return (
    <Grid templateColumns="1fr 1fr" gap={4}>
      <Field.Root>
        <Field.Label>Data from</Field.Label>
        <Input
          type="date"
          value={dayInputValue(props.fromMs)}
          onChange={(event) => {
            const ms = dayInputMs(event.target.value);
            if (ms !== undefined) props.onFrom(ms);
          }}
          data-testid="braid-from-date"
        />
        <Field.HelperText>{`Older spans stay in ${props.ownerName} only`}</Field.HelperText>
      </Field.Root>
      <Field.Root>
        <Field.Label>Ends</Field.Label>
        <Stack gap={2} width="full">
          <SegmentedControl
            size="sm"
            value={endsValue(props.ends)}
            onValueChange={({ value }) => value && pick(value)}
            items={[
              { value: "never", label: "Never" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "date", label: "A date" },
            ]}
            data-testid="braid-ends"
          />
          {props.ends.kind === "date" ? (
            <Input
              type="date"
              aria-label="End date"
              value={dayInputValue(props.ends.dateMs)}
              onChange={(event) => {
                const ms = dayInputMs(event.target.value);
                if (ms !== undefined) props.onEnds({ kind: "date", dateMs: ms });
              }}
            />
          ) : null}
        </Stack>
        <Field.HelperText>{`When ${props.readerName} stops seeing them`}</Field.HelperText>
      </Field.Root>
    </Grid>
  );
}
