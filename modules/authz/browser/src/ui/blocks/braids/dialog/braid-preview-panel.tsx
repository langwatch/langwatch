// What the reader will see: its traces over 7 days getting every, some or none of the owner's
// spans with the pair's live braids and this one, the spans this one adds, the calls held back for
// want of a signature, an example trace and one tested trace, seen by you only.

import { Banner } from "@langwatch/design-system/banner";
import {
  Badge,
  Box,
  Button,
  HStack,
  Input,
  Skeleton,
  Stack,
  Text,
} from "@langwatch/design-system/primitives";
import { Plus, ShieldCheck, Users } from "lucide-react";
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
  test:
    | { state: "idle" | "loading" | "error" | "not-found" }
    | { state: "ready"; rows: TestTraceRow[] };
  onTest: (traceId: string) => void;
};

const count = (value: number) => value.toLocaleString("en-GB");

function Legend({ colour, label, value }: { colour: string; label: string; value: number }) {
  return (
    <HStack gap={2} fontSize="sm">
      <Box
        width="10px"
        height="10px"
        borderRadius="sm"
        bg={colour}
        borderWidth="1px"
        borderColor="border"
        flexShrink={0}
      />
      <Text flex={1} color="fg.muted">
        {label}
      </Text>
      <Text fontVariantNumeric="tabular-nums">{count(value)}</Text>
    </HStack>
  );
}

function Counts({
  ownerName,
  readerName,
  traces,
}: {
  ownerName: string;
  readerName: string;
  traces: BraidPreviewCounts;
}) {
  if (traces.total === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="braid-preview-counts">
        {`${readerName} has no traces in the last 7 days, so there is nothing to count yet.`}
      </Text>
    );
  }
  const share = (value: number) => (value / traces.total) * 100;
  return (
    <Stack gap={3} data-testid="braid-preview-counts">
      <Text fontSize="xl" fontWeight="semibold">
        {count(traces.every + traces.some)}{" "}
        <Text as="span" fontSize="sm" fontWeight="normal" color="fg.muted">
          {`of ${count(traces.total)} traces get spans`}
        </Text>
      </Text>
      <HStack
        gap={0}
        height="8px"
        borderRadius="full"
        overflow="hidden"
        bg="bg.emphasized"
        aria-hidden
      >
        <Box height="full" width={`${share(traces.every)}%`} bg="blue.solid" />
        <Box height="full" width={`${share(traces.some)}%`} bg="blue.muted" />
      </HStack>
      <Stack gap={1}>
        <Legend colour="blue.solid" label={`Every ${ownerName} span`} value={traces.every} />
        <Legend colour="blue.muted" label="Some of its spans" value={traces.some} />
        <Legend colour="bg.emphasized" label={`Nothing from ${ownerName}`} value={traces.none} />
      </Stack>
      {traces.capped ? (
        <Text fontSize="xs" color="fg.muted" data-testid="braid-preview-capped">
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
    <Stack
      gap={1}
      padding={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.panel"
      data-testid={testId}
    >
      <Text fontSize="xs" color="fg.muted">
        {note}
      </Text>
      {rows.map((row) => (
        <HStack
          key={row.spanId}
          gap={2}
          paddingLeft={`${row.depth * 12}px`}
          data-kind={row.kind}
          data-testid={rowTestId}
        >
          <Text
            fontFamily="mono"
            fontSize="sm"
            color={row.kind === "withheld" ? "fg.muted" : "fg"}
            textDecoration={row.kind === "withheld" ? "line-through" : undefined}
          >
            {row.name}
          </Text>
          {row.kind === "braided" ? (
            <Badge size="sm" variant="subtle" colorPalette="blue">
              Braided
            </Badge>
          ) : null}
          {row.kind === "withheld" ? (
            <Text fontSize="xs" color="fg.muted">
              Never sent
            </Text>
          ) : null}
        </HStack>
      ))}
    </Stack>
  );
}

function TestTrace({ test, onTest }: Pick<BraidPreviewPanelProps, "test" | "onTest">) {
  const [traceId, setTraceId] = useState("");
  return (
    <Stack gap={2}>
      <Text fontWeight="medium" fontSize="sm">
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
        <Text fontSize="sm" color="fg.muted">
          The other project holds no trace with that id.
        </Text>
      ) : null}
      {test.state === "error" ? (
        <Text fontSize="sm" color="fg.error">
          Couldn't test that trace. Try again.
        </Text>
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
        <Text fontWeight="semibold" fontSize="sm">{`What ${reader} will see`}</Text>
        <Text fontSize="xs" color="fg.muted">
          Last 7 days, updates as you type
        </Text>
      </Stack>
      {preview.state === "no-reader" ? (
        <Text fontSize="sm" color="fg.muted">
          Pick a project to braid into to see a preview.
        </Text>
      ) : null}
      {preview.state === "refused" ? (
        <Text fontSize="sm" color="fg.error">
          Fix the condition to see a preview.
        </Text>
      ) : null}
      {preview.state === "error" ? (
        <Text fontSize="sm" color="fg.error">
          Couldn't load the preview. It updates when you change the braid.
        </Text>
      ) : null}
      {preview.state === "loading" ? <Skeleton height="120px" /> : null}
      {preview.state === "ready" ? (
        <>
          <Counts
            ownerName={props.ownerName}
            readerName={props.readerName ?? "The project"}
            traces={preview.traces}
          />
          {preview.added ? (
            <HStack gap={2} fontSize="sm" color="fg.muted" data-testid="braid-preview-added">
              <Plus size={14} aria-hidden />
              <Text>{addedPhrase({ ...preview.added, ownerName: props.ownerName })}</Text>
            </HStack>
          ) : null}
          {preview.unsignedHidden !== null && preview.unsignedHidden > 0 ? (
            <HStack gap={2} fontSize="sm" color="fg.muted" data-testid="braid-preview-unsigned">
              <ShieldCheck size={14} aria-hidden />
              <Text>{unsignedHiddenPhrase(preview.unsignedHidden)}</Text>
            </HStack>
          ) : null}
          {preview.example ? (
            <Stack gap={2}>
              <Text fontWeight="medium" fontSize="sm">
                An example trace
              </Text>
              <TraceRows
                rows={preview.example}
                note="The newest trace in the last 7 days that gets spans. Only you see it."
                testId="braid-preview-example"
                rowTestId="braid-example-span"
              />
            </Stack>
          ) : null}
        </>
      ) : null}
      {props.unsignedWarning ? (
        <Banner status="warning" title="Anyone can set a tag">
          {`Without signing, any caller that sets this tag can get spans shown in ${reader}.`}
        </Banner>
      ) : null}
      {props.readerName ? <TestTrace test={props.test} onTest={props.onTest} /> : null}
      {props.viewers ? (
        <HStack gap={2} fontSize="sm" color="fg.muted" data-testid="braid-viewers">
          <Users size={14} aria-hidden />
          <Text>{`${props.viewers} in ${reader} will see these spans`}</Text>
        </HStack>
      ) : null}
    </Stack>
  );
}

/** What this braid adds to the pair's other live braids, in spans. */
function addedPhrase({
  spans,
  braids,
  ownerName,
}: {
  spans: number;
  braids: number;
  ownerName: string;
}): string {
  const others = braids === 1 ? "the other braid" : `the ${count(braids)} other braids`;
  const more =
    spans === 0 ? "no more spans" : `${count(spans)} more ${spans === 1 ? "span" : "spans"}`;
  return `This braid shows ${more} than ${others} from ${ownerName} alone.`;
}

/** `unsignedHidden` counts spans, not calls. */
function unsignedHiddenPhrase(spans: number): string {
  return spans === 1
    ? "1 span had no valid signature and stays hidden."
    : `${count(spans)} spans had no valid signature and stay hidden.`;
}
