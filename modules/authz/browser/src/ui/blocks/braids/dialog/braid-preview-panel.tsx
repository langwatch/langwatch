// What the reader will see: its traces over 7 days getting every, some or none of the owner's
// spans with the pair's live braids and this one, the spans this one adds, the calls held back for
// want of a signature and an example trace; TestTrace runs one trace id, seen by you only.

import { Card } from "@langwatch/design-system/card";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import {
  Alert,
  Badge,
  Box,
  Button,
  HStack,
  Input,
  Skeleton,
  Stack,
  Text,
} from "@langwatch/design-system/primitives";
import { StatTileFigure } from "@langwatch/design-system/stat-tile";
import { ChevronDown, ChevronUp, Plus, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import type React from "react";
import { useState } from "react";

import type { TestTraceRow } from "../../../../model/braids/braid-draft.ts";

export type BraidPreviewCounts = {
  every: number;
  some: number;
  none: number;
  total: number;
  capped: boolean;
};

export type BraidPreviewPanelProps = {
  ownerName: string;
  readerName: string | undefined;
  preview:
    | { state: "no-reader" | "refused" | "loading" | "error" }
    | {
        state: "ready";
        traces: BraidPreviewCounts;
        unsignedHidden: number | null;
        /** Spans this braid shows beyond the pair's other live braids; null when it has none. */
        added: { spans: number; braids: number } | null;
        /** The newest counted trace that gets a braided span; null when none does. */
        example: TestTraceRow[] | null;
      };
  unsignedWarning: boolean;
  viewers: string | undefined;
  /** A trace was tested: the example trace starts folded so one tree shows in full. */
  exampleFolded?: boolean;
};

export type TestTraceProps = {
  test:
    | { state: "idle" | "loading" | "error" | "not-found" }
    | { state: "ready"; rows: TestTraceRow[] };
  onTest: (traceId: string) => void;
};

const count = (value: number) => value.toLocaleString("en-GB");

/** One entry of the meter's inline legend; `track` is the empty part, its swatch outlined. */
function Legend({
  colour,
  label,
  title,
  value,
  track = false,
}: {
  colour: string;
  label: string;
  title: string;
  value: number;
  track?: boolean;
}) {
  return (
    <HStack as="span" gap={1} title={title}>
      <Box
        boxSize="2"
        borderRadius="sm"
        bg={colour}
        borderWidth={track ? "1px" : undefined}
        borderColor={track ? "border.emphasized" : undefined}
        flexShrink={0}
        aria-hidden
      />
      <Text as="span">{`${label} ${count(value)}`}</Text>
    </HStack>
  );
}

function Counts({
  ownerName,
  readerName,
  traces,
  hint,
}: {
  ownerName: string;
  readerName: string;
  traces: BraidPreviewCounts;
  /** One line under the headline, such as the unsigned-tag caution. */
  hint?: React.ReactNode;
}) {
  if (traces.total === 0) {
    return (
      <Text textStyle="sm" color="fg.muted" data-testid="braid-preview-counts">
        {`${readerName} has no traces in the last 7 days, so there is nothing to count yet.`}
      </Text>
    );
  }
  const share = (value: number) => value / traces.total;
  return (
    <Stack gap={2} data-testid="braid-preview-counts">
      <StatTileFigure data-testid="braid-preview-figure">
        {`${count(traces.every + traces.some)} of ${count(traces.total)} traces`}
      </StatTileFigure>
      {hint}
      <MeterBar
        width="full"
        height="2"
        segments={[
          { ratio: share(traces.every), color: "blue.solid" },
          { ratio: share(traces.some), color: "blue.muted" },
        ]}
      />
      <HStack
        gap={3}
        textStyle="xs"
        color="fg.muted"
        fontVariantNumeric="tabular-nums"
        data-testid="braid-preview-legend"
      >
        <Legend
          colour="blue.solid"
          label="All"
          title={`All ${ownerName} spans show`}
          value={traces.every}
        />
        <Legend
          colour="blue.muted"
          label="Some"
          title={`Some ${ownerName} spans show`}
          value={traces.some}
        />
        <Legend
          colour="border.subtle"
          track
          label="None"
          title={`No ${ownerName} spans show`}
          value={traces.none}
        />
      </HStack>
      {traces.capped ? (
        <Text textStyle="xs" color="fg.muted" data-testid="braid-preview-capped">
          {`Counted over the most recent ${count(traces.total)} traces only; there are more.`}
        </Text>
      ) : null}
    </Stack>
  );
}

/** A trace as the reader will see it: braided spans marked, the owner's others struck through. */
function TraceRows({
  rows,
  note,
  testId,
  rowTestId,
}: {
  rows: TestTraceRow[];
  note: string;
  testId: string;
  rowTestId: string;
}) {
  return (
    <Card variant="frame" padding="sm" data-testid={testId}>
      <Stack gap={1}>
        <HStack gap={1.5} textStyle="xs" color="fg.muted">
          <FeatureMark feature="braids" size={12} />
          <Text>{note}</Text>
        </HStack>
        {rows.map((row) => (
          <HStack
            key={row.spanId}
            gap={2}
            paddingLeft={row.depth * 3}
            data-kind={row.kind}
            data-testid={rowTestId}
          >
            <Text
              fontFamily="mono"
              textStyle="sm"
              color={row.kind === "withheld" ? "fg.muted" : "fg"}
              textDecoration={row.kind === "withheld" ? "line-through" : undefined}
            >
              {row.name}
            </Text>
            {row.kind === "braided" ? (
              <Badge size="sm" variant="subtle" colorPalette="orange">
                Braided
              </Badge>
            ) : null}
            {row.kind === "withheld" ? (
              <Text textStyle="xs" color="fg.muted">
                Never sent
              </Text>
            ) : null}
          </HStack>
        ))}
      </Stack>
    </Card>
  );
}

/** The preview's example trace: starts folded, and folds again when a trace is tested. */
function ExampleTrace({ rows, folded }: { rows: TestTraceRow[]; folded: boolean }) {
  const [opened, setOpened] = useState(false);
  const [wasFolded, setWasFolded] = useState(folded);
  if (folded !== wasFolded) {
    setWasFolded(folded);
    if (folded) setOpened(false);
  }
  return (
    <Stack gap={2}>
      <Button
        size="xs"
        variant="ghost"
        alignSelf="start"
        aria-expanded={opened}
        onClick={() => setOpened(!opened)}
        data-testid="braid-preview-example-toggle"
      >
        {opened ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
        {opened ? "Hide the example trace" : "Show an example trace"}
      </Button>
      {opened ? (
        <TraceRows
          rows={rows}
          note="The newest trace in the last 7 days that gets spans. Only you see it."
          testId="braid-preview-example"
          rowTestId="braid-example-span"
        />
      ) : null}
    </Stack>
  );
}

/** One trace id run through the draft braid, shown to you only. */
export function TestTrace({ test, onTest }: TestTraceProps) {
  const [traceId, setTraceId] = useState("");
  return (
    <Stack gap={2}>
      <Text fontWeight="medium" textStyle="sm">
        Test a trace
      </Text>
      <HStack
        as="form"
        gap={2}
        onSubmit={(event) => {
          event.preventDefault();
          if (traceId.trim()) onTest(traceId.trim());
        }}
      >
        <Input
          size="sm"
          aria-label="Trace id"
          placeholder="Paste a trace id"
          value={traceId}
          onChange={(event) => setTraceId(event.target.value)}
          fontFamily="mono"
        />
        <Button
          size="sm"
          type="submit"
          variant="outline"
          loading={test.state === "loading"}
          data-testid="braid-test"
        >
          Test
        </Button>
      </HStack>
      {test.state === "not-found" ? (
        <Text textStyle="sm" color="fg.muted">
          The other project holds no trace with that id.
        </Text>
      ) : null}
      {test.state === "error" ? (
        <Alert.Root status="error" size="sm" data-testid="braid-test-error">
          <Alert.Indicator />
          <Alert.Title fontWeight="normal">Couldn't test that trace. Try again.</Alert.Title>
        </Alert.Root>
      ) : null}
      {test.state === "ready" ? (
        <TraceRows
          rows={test.rows}
          note="Only you see this test; nothing is saved."
          testId="braid-test-trace"
          rowTestId="braid-test-span"
        />
      ) : null}
    </Stack>
  );
}

export function BraidPreviewPanel(props: BraidPreviewPanelProps) {
  const reader = props.readerName ?? "the other project";
  const { preview } = props;
  return (
    <Stack gap={4} data-testid="braid-preview">
      <Stack gap={0}>
        <Text fontWeight="semibold" textStyle="sm">{`What ${reader} will see`}</Text>
        <Text textStyle="xs" color="fg.muted">
          Last 7 days, updates as you type
        </Text>
      </Stack>
      {preview.state === "no-reader" ? (
        <Text textStyle="sm" color="fg.muted">
          Pick a project to braid into to see a preview.
        </Text>
      ) : null}
      {preview.state === "refused" ? (
        <Alert.Root status="info" size="sm" data-testid="braid-preview-refused">
          <Alert.Indicator />
          <Alert.Title fontWeight="normal">Fix the condition to see a preview.</Alert.Title>
        </Alert.Root>
      ) : null}
      {preview.state === "error" ? (
        <Alert.Root status="error" size="sm" data-testid="braid-preview-error">
          <Alert.Indicator />
          <Alert.Title fontWeight="normal">
            Couldn't load the preview. It tries again when you change the braid.
          </Alert.Title>
        </Alert.Root>
      ) : null}
      {preview.state === "loading" ? <Skeleton height="32" /> : null}
      {preview.state === "ready" ? (
        <>
          <Counts
            ownerName={props.ownerName}
            readerName={props.readerName ?? "The project"}
            traces={preview.traces}
            hint={props.unsignedWarning ? <UnsignedHint reader={reader} /> : undefined}
          />
          {preview.added ? <AddedLine added={preview.added} /> : null}
          {preview.unsignedHidden !== null && preview.unsignedHidden > 0 ? (
            <HStack gap={2} textStyle="sm" color="fg.muted" data-testid="braid-preview-unsigned">
              <ShieldCheck size={14} aria-hidden />
              <Text>{unsignedHiddenPhrase(preview.unsignedHidden)}</Text>
            </HStack>
          ) : null}
          {preview.example ? (
            <ExampleTrace rows={preview.example} folded={props.exampleFolded ?? false} />
          ) : null}
        </>
      ) : null}
      {props.viewers ? (
        <HStack gap={2} textStyle="sm" color="fg.muted" data-testid="braid-viewers">
          <Users size={14} aria-hidden />
          <Text>{`${props.viewers} in ${reader} will see these spans`}</Text>
        </HStack>
      ) : null}
    </Stack>
  );
}

/** Without signing, a tag is only a claim: one quiet caution under the headline. */
function UnsignedHint({ reader }: { reader: string }) {
  return (
    <HStack gap={1.5} textStyle="xs" color="fg.warning" data-testid="braid-preview-unsigned-hint">
      <TriangleAlert size={12} aria-hidden />
      <Text>{`Anyone can set a tag: without signing, any caller can get spans shown in ${reader}.`}</Text>
    </HStack>
  );
}

/** What this braid adds; adding nothing is the case worth a warning. */
function AddedLine({ added }: { added: { spans: number; braids: number } }) {
  const nothing = added.spans === 0;
  return (
    <HStack
      gap={1.5}
      textStyle={nothing ? "xs" : "sm"}
      color={nothing ? "fg.warning" : "fg.muted"}
      data-testid="braid-preview-added"
    >
      {nothing ? <TriangleAlert size={12} aria-hidden /> : <Plus size={14} aria-hidden />}
      <Text>{addedPhrase(added)}</Text>
    </HStack>
  );
}

/** What this braid adds to the pair's other live braids, in spans. */
function addedPhrase({ spans, braids }: { spans: number; braids: number }): string {
  const one = braids === 1;
  const others = one ? "the other braid" : `the ${count(braids)} other braids`;
  if (spans === 0) {
    return `Adds no spans: ${others} already ${one ? "shows" : "show"} every span this one would.`;
  }
  return `Adds ${count(spans)} ${spans === 1 ? "span" : "spans"} that ${others} ${one ? "doesn't" : "don't"} show.`;
}

/** `unsignedHidden` counts spans, not calls. */
function unsignedHiddenPhrase(spans: number): string {
  return spans === 1
    ? "1 span had no valid signature and stays hidden."
    : `${count(spans)} spans had no valid signature and stay hidden.`;
}
