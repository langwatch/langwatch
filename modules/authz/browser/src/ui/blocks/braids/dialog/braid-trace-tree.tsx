// A trace as the reader will see it: a tree with guides, the reader's own spans as quiet context,
// braided spans in full with the owner's avatar, withheld ones muted and marked not braided.
// TestTrace runs one trace id through the draft braid, seen by you only.

import { Card } from "@langwatch/design-system/card";
import {
  Alert,
  Box,
  Button,
  HStack,
  Input,
  Stack,
  Text,
} from "@langwatch/design-system/primitives";
import { ProjectAvatar } from "@langwatch/design-system/project-avatar";
import { EyeOff } from "lucide-react";
import { useState } from "react";

import type { TestTraceRow } from "../../../../model/braids/braid-draft.ts";

export type TestTraceProps = {
  test:
    | { state: "idle" | "loading" | "error" | "not-found" }
    | { state: "ready"; rows: TestTraceRow[] };
  onTest: (traceId: string) => void;
  ownerName: string;
  readerName: string;
};

const ROW_HEIGHT = "7";
const GUIDE_WIDTH = "4";

/** Per level of a row: whether a guide runs on past it, the last level being the row's own. */
function guidesOf(rows: readonly TestTraceRow[]): boolean[][] {
  return rows.map((row, index) => {
    const continues: boolean[] = [];
    for (let level = 1; level <= row.depth; level++) {
      let more = false;
      for (const later of rows.slice(index + 1)) {
        if (later.depth < level) break;
        if (later.depth === level) {
          more = true;
          break;
        }
      }
      continues.push(more);
    }
    return continues;
  });
}

/** One indent column: a straight guide for an ancestor, an elbow for the row's own level. */
function Guide({ own, continues }: { own: boolean; continues: boolean }) {
  return (
    <Box position="relative" width={GUIDE_WIDTH} height={ROW_HEIGHT} flexShrink={0} aria-hidden>
      {continues || own ? (
        <Box
          position="absolute"
          left="7px"
          top={0}
          bottom={continues ? 0 : "50%"}
          width="1px"
          bg="border.emphasized"
        />
      ) : null}
      {own ? (
        <Box
          position="absolute"
          left="7px"
          right="2px"
          top="50%"
          height="1px"
          bg="border.emphasized"
        />
      ) : null}
    </Box>
  );
}

function SpanName({ row, ownerName }: { row: TestTraceRow; ownerName: string }) {
  if (row.kind === "braided") {
    return (
      <HStack gap={1.5} minWidth={0} title={`From ${ownerName}`}>
        <ProjectAvatar name={ownerName} size="xs" />
        <Text textStyle="label" color="fg" truncate>
          {row.name}
        </Text>
      </HStack>
    );
  }
  if (row.kind === "withheld") {
    return (
      <HStack gap={1.5} minWidth={0} color="fg.subtle">
        <EyeOff size={14} aria-hidden />
        <Text textStyle="bodySm" truncate>
          {row.name}
        </Text>
        <Text textStyle="caption" flexShrink={0}>
          not braided
        </Text>
      </HStack>
    );
  }
  return (
    <Text textStyle="bodySm" color="fg.muted" truncate>
      {row.name}
    </Text>
  );
}

function summaryOf(rows: readonly TestTraceRow[]): string {
  const braided = rows.filter((row) => row.kind === "braided").length;
  const withheld = rows.filter((row) => row.kind === "withheld").length;
  const spans = `${braided} ${braided === 1 ? "span" : "spans"} braided in`;
  return withheld > 0 ? `${spans} · ${withheld} withheld` : spans;
}

export function TraceTree({
  rows,
  ownerName,
  readerName,
  caption,
  testId,
  rowTestId,
}: {
  rows: TestTraceRow[];
  ownerName: string;
  readerName: string;
  caption: string;
  testId: string;
  rowTestId: string;
}) {
  const guides = guidesOf(rows);
  const withheld = rows.some((row) => row.kind === "withheld");
  return (
    <Stack gap={1.5} data-testid={testId}>
      <Card variant="frame" padding="sm">
        <Stack gap={2}>
          <Text textStyle="label" data-testid={`${testId}-summary`}>
            {summaryOf(rows)}
          </Text>
          <Box>
            {rows.map((row, index) => (
              <HStack
                key={row.spanId}
                gap={0}
                height={ROW_HEIGHT}
                minWidth={0}
                data-kind={row.kind}
                data-testid={rowTestId}
              >
                {(guides[index] ?? []).map((continues, level) => (
                  <Guide key={level} own={level === row.depth - 1} continues={continues} />
                ))}
                <Box minWidth={0} paddingLeft={row.depth > 0 ? 1 : 0}>
                  <SpanName row={row} ownerName={ownerName} />
                </Box>
              </HStack>
            ))}
          </Box>
          <HStack
            gap={3}
            rowGap={1}
            wrap="wrap"
            textStyle="caption"
            color="fg.muted"
            borderTopWidth="1px"
            borderColor="border.subtle"
            paddingTop={2}
          >
            <HStack gap={1} title={`Braided in from ${ownerName}`}>
              <ProjectAvatar name={ownerName} size="xs" />
              <Text>Braided in</Text>
            </HStack>
            <Text>{`${readerName}'s own`}</Text>
            {withheld ? (
              <HStack gap={1}>
                <EyeOff size={12} aria-hidden />
                <Text>Not braided</Text>
              </HStack>
            ) : null}
          </HStack>
        </Stack>
      </Card>
      <Text textStyle="caption" color="fg.muted">
        {caption}
      </Text>
    </Stack>
  );
}

/** One trace id run through the draft braid, shown to you only. */
export function TestTrace({ test, onTest, ownerName, readerName }: TestTraceProps) {
  const [traceId, setTraceId] = useState("");
  return (
    <Stack gap={3}>
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
          placeholder={`Paste a trace id from ${readerName}`}
          value={traceId}
          onChange={(event) => setTraceId(event.target.value)}
          fontFamily={traceId ? "mono" : "body"}
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
        <Text textStyle="bodySm" color="fg.muted">
          {`${readerName} holds no trace with that id.`}
        </Text>
      ) : null}
      {test.state === "error" ? (
        <Alert.Root status="error" size="sm" data-testid="braid-test-error">
          <Alert.Indicator />
          <Alert.Title fontWeight="normal">Couldn't test that trace. Try again.</Alert.Title>
        </Alert.Root>
      ) : null}
      {test.state === "ready" ? (
        <TraceTree
          rows={test.rows}
          ownerName={ownerName}
          readerName={readerName}
          caption="Only you see this test; nothing is saved."
          testId="braid-test-trace"
          rowTestId="braid-test-span"
        />
      ) : null}
    </Stack>
  );
}
