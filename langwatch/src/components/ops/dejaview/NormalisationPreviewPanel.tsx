import {
  Badge,
  Box,
  Button,
  Center,
  HStack,
  Input,
  NativeSelect,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { FlaskConical, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, type RouterOutputs } from "~/utils/api";

/**
 * Deja View normalisation preview: replays this aggregate's stored raw
 * span events through the canonicalisation code of the RUNNING build and
 * shows the produced attributes, the rules that fired, and the drift vs
 * what is stored. Experimental mapping rules (blocks below) run on top so
 * a new vendor mapping can be prototyped against real events before an
 * extractor exists. Read-only.
 */

type RuleDraft = {
  key: string;
  keyIsRegex: boolean;
  valuePattern: string;
  actionType: "copy" | "move";
  targetKey: string;
};

const emptyRule = (): RuleDraft => ({
  key: "",
  keyIsRegex: false,
  valuePattern: "",
  actionType: "copy",
  targetKey: "",
});

export function NormalisationPreviewPanel({
  aggregateId,
  tenantId,
}: {
  aggregateId: string;
  tenantId: string;
}) {
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const preview = api.ops.previewNormalisation.useMutation();

  const updateRule = (index: number, patch: Partial<RuleDraft>) => {
    setRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  };

  const run = () => {
    preview.mutate({
      aggregateId,
      tenantId,
      rules: rules
        .filter((r) => r.key.length > 0 && r.targetKey.length > 0)
        .map((r) => ({
          match: {
            key: r.key,
            keyIsRegex: r.keyIsRegex,
            valuePattern: r.valuePattern.length > 0 ? r.valuePattern : undefined,
          },
          action: { type: r.actionType, targetKey: r.targetKey },
        })),
    });
  };

  const result = preview.data;

  return (
    <Box flex={1} overflowY="auto" minH={0} w="full" padding={6}>
      <VStack align="stretch" gap={4} maxW="1200px">
        <HStack gap={2}>
          <FlaskConical size={16} />
          <Text textStyle="sm" fontWeight="semibold">
            Normalisation preview
          </Text>
          <Text textStyle="xs" color="fg.muted">
            Replays this aggregate&apos;s stored span events through the
            canonicalisation code of this build. Read-only.
          </Text>
        </HStack>

        <VStack
          align="stretch"
          gap={2}
          padding={3}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
        >
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">
            Experimental mapping rules (optional)
          </Text>
          {rules.map((rule, index) => (
            <HStack key={index} gap={2} align="center">
              <Input
                size="xs"
                fontFamily="mono"
                placeholder="source key"
                value={rule.key}
                onChange={(e) => updateRule(index, { key: e.target.value })}
                flex={2}
              />
              <Button
                size="xs"
                variant={rule.keyIsRegex ? "solid" : "outline"}
                colorPalette={rule.keyIsRegex ? "blue" : "gray"}
                onClick={() =>
                  updateRule(index, { keyIsRegex: !rule.keyIsRegex })
                }
                title="Treat source key as a regex"
              >
                .*
              </Button>
              <Input
                size="xs"
                fontFamily="mono"
                placeholder="value regex (group 1 extracted, optional)"
                value={rule.valuePattern}
                onChange={(e) =>
                  updateRule(index, { valuePattern: e.target.value })
                }
                flex={2}
              />
              <NativeSelect.Root size="xs" width="90px" flexShrink={0}>
                <NativeSelect.Field
                  value={rule.actionType}
                  onChange={(e) =>
                    updateRule(index, {
                      actionType: e.target.value as "copy" | "move",
                    })
                  }
                >
                  <option value="copy">copy →</option>
                  <option value="move">move →</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
              <Input
                size="xs"
                fontFamily="mono"
                placeholder="target key (e.g. langwatch.input)"
                value={rule.targetKey}
                onChange={(e) =>
                  updateRule(index, { targetKey: e.target.value })
                }
                flex={2}
              />
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setRules((prev) => prev.filter((_, i) => i !== index))
                }
                title="Remove rule"
              >
                <Trash2 size={13} />
              </Button>
            </HStack>
          ))}
          <HStack>
            <Button
              size="xs"
              variant="outline"
              onClick={() => setRules((prev) => [...prev, emptyRule()])}
            >
              <Plus size={13} />
              Add rule
            </Button>
            <Box flex={1} />
            <Button
              size="xs"
              colorPalette="blue"
              onClick={run}
              loading={preview.isPending}
            >
              <Play size={13} />
              Run preview
            </Button>
          </HStack>
        </VStack>

        {preview.error && (
          <Box
            padding={3}
            borderRadius="md"
            borderWidth="1px"
            borderColor="red.200"
          >
            <Text textStyle="xs" color="red.500">
              {preview.error.message}
            </Text>
          </Box>
        )}

        {preview.isPending && (
          <Center paddingY={8}>
            <Spinner size="md" />
          </Center>
        )}

        {result && (
          <VStack align="stretch" gap={3}>
            <HStack gap={2} wrap="wrap">
              <Badge size="sm" variant="outline">
                {result.eventsScanned} events scanned
              </Badge>
              <Badge size="sm" variant="outline">
                {result.spanEventsFound} span events
              </Badge>
              {result.skippedInvalidEvents > 0 && (
                <Badge size="sm" variant="outline" colorPalette="orange">
                  {result.skippedInvalidEvents} unparseable
                </Badge>
              )}
              {result.ruleStats.map((stat) => (
                <Badge
                  key={stat.ruleIndex}
                  size="sm"
                  variant="subtle"
                  colorPalette={stat.matchedSpanCount > 0 ? "green" : "gray"}
                >
                  rule {stat.ruleIndex + 1}: {stat.matchedSpanCount} span
                  {stat.matchedSpanCount === 1 ? "" : "s"}
                </Badge>
              ))}
            </HStack>

            {result.spans.length === 0 && (
              <Text textStyle="sm" color="fg.muted">
                No span-received events to replay in this aggregate.
              </Text>
            )}

            {result.spans.map((span) => (
              <SpanPreviewCard key={span.spanId} span={span} />
            ))}
          </VStack>
        )}
      </VStack>
    </Box>
  );
}

type SpanPreview =
  RouterOutputs["ops"]["previewNormalisation"]["spans"][number];

function SpanPreviewCard({ span }: { span: SpanPreview }) {
  const [showAttributes, setShowAttributes] = useState(false);

  return (
    <VStack
      align="stretch"
      gap={2}
      padding={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
    >
      <HStack gap={2}>
        <Text textStyle="sm" fontWeight="medium">
          {span.name}
        </Text>
        <Text textStyle="xs" fontFamily="mono" color="fg.muted">
          {span.spanId}
        </Text>
        <Box flex={1} />
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setShowAttributes((s) => !s)}
        >
          {showAttributes ? "Hide" : "Show"} replayed attributes
        </Button>
      </HStack>

      {span.appliedRules.length > 0 && (
        <HStack gap={1} wrap="wrap">
          {span.appliedRules.map((rule, i) => (
            <Badge key={i} size="sm" variant="subtle" fontFamily="mono">
              {rule}
            </Badge>
          ))}
        </HStack>
      )}

      {span.storedDiff !== null && (
        <DiffSection
          title={
            span.storedDiff.length === 0
              ? "Stored vs replayed: identical (this build reproduces storage)"
              : `Stored vs replayed: ${span.storedDiff.length} attribute(s) differ`
          }
          entries={span.storedDiff}
        />
      )}

      {span.rulesDiff !== null && (
        <DiffSection
          title={
            span.rulesDiff.length === 0
              ? "Mapping rules: no effect on this span"
              : `Mapping rules: ${span.rulesDiff.length} attribute(s) affected`
          }
          entries={span.rulesDiff}
        />
      )}

      {showAttributes && (
        <Box
          as="pre"
          padding={2}
          borderRadius="sm"
          bg="bg.muted"
          overflowX="auto"
          textStyle="xs"
          fontFamily="mono"
        >
          {JSON.stringify(span.replayedAttributes, null, 2)}
        </Box>
      )}
    </VStack>
  );
}

const DIFF_COLOR: Record<string, string> = {
  added: "green",
  removed: "red",
  changed: "orange",
};

function DiffSection({
  title,
  entries,
}: {
  title: string;
  entries: NonNullable<SpanPreview["storedDiff"]>;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text textStyle="xs" color="fg.muted">
        {title}
      </Text>
      {entries.length > 0 && (
        <Box overflowX="auto">
          <Table.Root size="sm" variant="line">
            <Table.Body>
              {entries.map((entry) => (
                <Table.Row key={`${entry.kind}:${entry.key}`}>
                  <Table.Cell width="90px">
                    <Badge
                      size="sm"
                      variant="subtle"
                      colorPalette={DIFF_COLOR[entry.kind] ?? "gray"}
                    >
                      {entry.kind}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell fontFamily="mono" textStyle="xs">
                    {entry.key}
                  </Table.Cell>
                  <Table.Cell
                    fontFamily="mono"
                    textStyle="xs"
                    color="fg.muted"
                    maxW="300px"
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                    title={entry.before ?? undefined}
                  >
                    {entry.before ?? "—"}
                  </Table.Cell>
                  <Table.Cell
                    fontFamily="mono"
                    textStyle="xs"
                    maxW="300px"
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                    title={entry.after ?? undefined}
                  >
                    {entry.after ?? "—"}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}
    </VStack>
  );
}
