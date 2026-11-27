// What the reader will see: two headline figures and the share of its traces getting every, some
// or none of the owner's spans (or, when the braid adds nothing, that first), then one list of
// notes by severity, an example trace, and a trace id to try the draft against.

import type { AuthzBraid } from "@langwatch/authz-contract";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import {
  Alert,
  Box,
  Button,
  HStack,
  Separator,
  Skeleton,
  Stack,
  Text,
} from "@langwatch/design-system/primitives";
import { StatTileFigure } from "@langwatch/design-system/stat-tile";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import type { TestTraceRow } from "../../../../model/braids/braid-draft.ts";
import { BraidPairBraids } from "./braid-pair-braids.tsx";
import { TestTrace, type TestTraceProps, TraceTree } from "./braid-trace-tree.tsx";

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
  /** Turns on only signed calls, the unsigned warning's fix. */
  onSignedCalls: () => void;
  viewers: string | undefined;
  /** The pair's other live braids, a quiet line that opens to each. */
  pairBraids: readonly AuthzBraid[];
  test: TestTraceProps["test"];
  onTest: (traceId: string) => void;
};

const count = (value: number) => value.toLocaleString("en-GB");

/** One entry of the meter's legend; `track` is the empty part, its swatch outlined. */
function Legend({
  colour,
  label,
  title,
  track = false,
}: {
  colour: string;
  label: string;
  title: string;
  track?: boolean;
}) {
  return (
    <HStack as="span" gap={1.5} title={title}>
      <Box
        boxSize="2"
        borderRadius="full"
        bg={colour}
        borderWidth={track ? "1px" : undefined}
        borderColor={track ? "border.emphasized" : undefined}
        flexShrink={0}
        aria-hidden
      />
      <Text as="span">{label}</Text>
    </HStack>
  );
}

/** A headline figure over its caption. */
function Figure({
  figure,
  caption,
  testId,
  figureTestId,
}: {
  figure: string;
  caption: string;
  testId?: string;
  figureTestId?: string;
}) {
  return (
    <Stack gap={0} minWidth={0} data-testid={testId}>
      <StatTileFigure data-testid={figureTestId}>{figure}</StatTileFigure>
      <Text textStyle="caption" color="fg.muted">
        {caption}
      </Text>
    </Stack>
  );
}

function Counts({
  ownerName,
  readerName,
  traces,
  viewers,
}: {
  ownerName: string;
  readerName: string;
  traces: BraidPreviewCounts;
  viewers: string | undefined;
}) {
  if (traces.total === 0) {
    return (
      <Stack gap={3} data-testid="braid-preview-counts">
        <Text textStyle="bodySm" color="fg.muted">
          {`${readerName} has no traces in the last 7 days, so there is nothing to count yet.`}
        </Text>
        {viewers ? <Viewers viewers={viewers} readerName={readerName} /> : null}
      </Stack>
    );
  }
  const share = (value: number) => value / traces.total;
  return (
    <Stack gap={3} data-testid="braid-preview-counts">
      <HStack gap={8} align="start">
        <Figure
          figure={`${count(traces.every + traces.some)} / ${count(traces.total)}`}
          caption="traces get spans"
          figureTestId="braid-preview-figure"
        />
        {viewers ? <Viewers viewers={viewers} readerName={readerName} /> : null}
      </HStack>
      <Stack gap={1.5}>
        <MeterBar
          width="full"
          height="2"
          segments={[
            { ratio: share(traces.every), color: "blue.solid" },
            { ratio: share(traces.some), color: "blue.muted" },
          ]}
        />
        <HStack
          gap={4}
          textStyle="caption"
          color="fg.muted"
          fontVariantNumeric="tabular-nums"
          data-testid="braid-preview-legend"
        >
          <Legend
            colour="blue.solid"
            label={`${count(traces.every)} every span`}
            title={`Every ${ownerName} span shows`}
          />
          <Legend
            colour="blue.muted"
            label={`${count(traces.some)} some`}
            title={`Some ${ownerName} spans show`}
          />
          <Legend
            colour="bg.panel"
            track
            label={`${count(traces.none)} none`}
            title={`No ${ownerName} spans show`}
          />
        </HStack>
      </Stack>
      {traces.capped ? (
        <Text textStyle="caption" color="fg.muted" data-testid="braid-preview-capped">
          {`Counted over the most recent ${count(traces.total)} traces only; there are more.`}
        </Text>
      ) : null}
    </Stack>
  );
}

function Viewers({ viewers, readerName }: { viewers: string; readerName: string }) {
  return (
    <Box minWidth={0} data-testid="braid-viewers">
      <Figure figure={viewers} caption={`in ${readerName} will see these spans`} />
    </Box>
  );
}

/** The preview's example trace: starts folded, and folds again when a trace is tested. */
function ExampleTrace({
  rows,
  folded,
  ownerName,
  readerName,
}: {
  rows: TestTraceRow[];
  folded: boolean;
  ownerName: string;
  readerName: string;
}) {
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
        marginLeft={-2}
        color="fg.muted"
        aria-expanded={opened}
        onClick={() => setOpened(!opened)}
        data-testid="braid-preview-example-toggle"
      >
        {opened ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
        {opened ? "Hide the example trace" : "Show an example trace"}
      </Button>
      {opened ? (
        <TraceTree
          rows={rows}
          ownerName={ownerName}
          readerName={readerName}
          caption="The newest trace in the last 7 days that gets spans. Only you see it."
          testId="braid-preview-example"
          rowTestId="braid-example-span"
        />
      ) : null}
    </Stack>
  );
}

/** One note of the preview, all in one style: a status, a claim, and an action where one helps. */
function Note({
  status,
  title,
  testId,
  children,
}: {
  status: "warning" | "info";
  title?: ReactNode;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <Alert.Root status={status} variant="outline" size="sm" data-testid={testId}>
      <Alert.Indicator />
      <Alert.Content>
        {title ? <Alert.Title>{title}</Alert.Title> : null}
        {children}
      </Alert.Content>
    </Alert.Root>
  );
}

/** The braid adds no span the pair's other braids lack: said first, the counts quiet under it. */
function Redundant({
  braids,
  others,
  readerName,
  traces,
  viewers,
}: {
  braids: readonly AuthzBraid[];
  others: number;
  readerName: string;
  traces: BraidPreviewCounts;
  viewers: string | undefined;
}) {
  const summary = (
    <Stack gap={0.5} data-testid="braid-preview-added">
      <Text textStyle="metric">Adds nothing new</Text>
      <Text textStyle="bodySm" color="fg.muted">
        {others === 1
          ? "The other braid already shows these spans."
          : `The ${count(others)} other braids already show these spans.`}
      </Text>
    </Stack>
  );
  const got = traces.every + traces.some;
  return (
    <Stack gap={3}>
      {braids.length > 0 ? <BraidPairBraids braids={braids} summary={summary} /> : summary}
      <Text textStyle="caption" color="fg.muted" data-testid="braid-preview-counts">
        {traces.total === 0
          ? `${readerName} has no traces in the last 7 days.`
          : `Together they reach ${count(got)} of ${count(traces.total)} traces${viewers ? ` · ${viewers} will see them` : ""}.`}
      </Text>
    </Stack>
  );
}

/** The notes, one list most severe first: the forgeable tag, the pair's braids, unsigned spans. */
function Notes({
  reader,
  warnUnsigned,
  onSignedCalls,
  pairBraids,
  added,
  hidden,
}: {
  reader: string;
  warnUnsigned: boolean;
  onSignedCalls: () => void;
  pairBraids: readonly AuthzBraid[];
  /** What the braid adds beyond the pair's braids; null when it adds nothing or there are none. */
  added: { spans: number; braids: number } | null;
  hidden: number;
}) {
  const addedTitle = added ? (
    <Text as="span" data-testid="braid-preview-added">
      {addedPhrase(added)}
    </Text>
  ) : null;
  const pairTitle =
    addedTitle ??
    `${pairBraids.length} other ${pairBraids.length === 1 ? "braid" : "braids"} into ${reader}`;
  const any = warnUnsigned || pairBraids.length > 0 || added !== null || hidden > 0;
  if (!any) return null;
  return (
    <Stack gap={2} data-testid="braid-preview-notes">
      {warnUnsigned ? (
        <Note status="warning" title="Anyone can set this tag" testId="braid-preview-unsigned-hint">
          <Alert.Description>
            {`Without signing, any caller can get spans shown in ${reader}.`}
          </Alert.Description>
          <Button
            size="xs"
            variant="outline"
            alignSelf="start"
            marginTop={2}
            onClick={onSignedCalls}
          >
            Turn on only signed calls
          </Button>
        </Note>
      ) : null}
      {pairBraids.length > 0 ? (
        <Note status="info">
          <BraidPairBraids braids={pairBraids} summary={<Alert.Title>{pairTitle}</Alert.Title>} />
        </Note>
      ) : null}
      {addedTitle && pairBraids.length === 0 ? <Note status="info" title={addedTitle} /> : null}
      {hidden > 0 ? (
        <Note
          status="info"
          title={
            <Text as="span" data-testid="braid-preview-unsigned">
              {unsignedHiddenPhrase(hidden)}
            </Text>
          }
        />
      ) : null}
    </Stack>
  );
}

/** What stands in for the counts before they are ready. */
function NotReady({ state }: { state: BraidPreviewPanelProps["preview"]["state"] }) {
  if (state === "no-reader") {
    return (
      <Text textStyle="bodySm" color="fg.muted">
        Pick a project to braid into to see a preview.
      </Text>
    );
  }
  if (state === "refused") {
    return (
      <Text textStyle="bodySm" color="fg.muted" data-testid="braid-preview-refused">
        Fix the condition to see a preview.
      </Text>
    );
  }
  if (state === "error") {
    return (
      <Alert.Root status="error" size="sm" data-testid="braid-preview-error">
        <Alert.Indicator />
        <Alert.Title fontWeight="normal">
          Couldn't load the preview. It tries again when you change the braid.
        </Alert.Title>
      </Alert.Root>
    );
  }
  return state === "loading" ? <Skeleton height="24" /> : null;
}

export function BraidPreviewPanel(props: BraidPreviewPanelProps) {
  const reader = props.readerName ?? "the other project";
  const readerTitle = props.readerName ?? "The project";
  const { preview } = props;
  const ready = preview.state === "ready" ? preview : undefined;
  const redundant = ready?.added?.spans === 0 ? ready.added : undefined;
  const pairBraids = props.readerName ? props.pairBraids : [];
  return (
    <Stack gap={5} data-testid="braid-preview">
      <Stack gap={0.5}>
        <Text as="h3" textStyle="cardTitle">{`What ${reader} will see`}</Text>
        <Text textStyle="caption" color="fg.muted">
          Last 7 days · updates as you type
        </Text>
      </Stack>
      <NotReady state={preview.state} />
      {ready && redundant ? (
        <Redundant
          braids={pairBraids}
          others={redundant.braids}
          readerName={readerTitle}
          traces={ready.traces}
          viewers={props.viewers}
        />
      ) : null}
      {ready && !redundant ? (
        <Counts
          ownerName={props.ownerName}
          readerName={readerTitle}
          traces={ready.traces}
          viewers={props.viewers}
        />
      ) : null}
      {preview.state === "loading" && props.viewers ? (
        <Viewers viewers={props.viewers} readerName={reader} />
      ) : null}
      <Notes
        reader={reader}
        warnUnsigned={!!ready && props.unsignedWarning}
        onSignedCalls={props.onSignedCalls}
        pairBraids={redundant ? [] : pairBraids}
        added={redundant ? null : (ready?.added ?? null)}
        hidden={ready?.unsignedHidden ?? 0}
      />
      {ready?.example ? (
        <ExampleTrace
          rows={ready.example}
          folded={props.test.state === "ready"}
          ownerName={props.ownerName}
          readerName={reader}
        />
      ) : null}
      {props.readerName ? (
        <>
          <Separator />
          <Stack gap={3}>
            <Text as="h3" textStyle="cardTitle">
              Try a trace
            </Text>
            <TestTrace
              test={props.test}
              onTest={props.onTest}
              ownerName={props.ownerName}
              readerName={props.readerName}
            />
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}

/** What this braid adds to the pair's other live braids, in spans; never zero (see Redundant). */
function addedPhrase({ spans, braids }: { spans: number; braids: number }): string {
  const one = braids === 1;
  const others = one ? "the other braid" : `the ${count(braids)} other braids`;
  return `Adds ${count(spans)} ${spans === 1 ? "span" : "spans"} that ${others} ${one ? "doesn't" : "don't"} show.`;
}

/** `unsignedHidden` counts spans, not calls. */
function unsignedHiddenPhrase(spans: number): string {
  return spans === 1
    ? "1 span had no valid signature and stays hidden."
    : `${count(spans)} spans had no valid signature and stay hidden.`;
}
