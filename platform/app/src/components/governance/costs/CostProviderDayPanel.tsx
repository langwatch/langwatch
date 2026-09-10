import { chakra, HStack, Text, VStack } from "@chakra-ui/react";
import type { GovernanceCostProviderDayRowDto } from "@ee/governance/services/governanceCost.service";
import { useState } from "react";

import { api } from "~/utils/api";

import { formatLaneUsd } from "../costLaneFormat";
import { providerName } from "./CostProviderBreakdown";

/**
 * Each day of the window, split by the provider that charged for it.
 *
 * The screen could already say what a provider cost over a quarter, and what
 * the organization spent on a given day. It could not say which provider
 * caused a day that stood out, which is the first question anybody asks of a
 * day that stood out — so the answer took a spreadsheet and two exports.
 *
 * Every figure here is one (day, provider) pair, never a day total beside a
 * provider total: reading a row across gives the provider's window, reading a
 * column down gives the day, and both are the sum of the figures shown rather
 * than a separate number that could disagree with them.
 */
export function CostProviderDayPanel({
  organizationId,
  rows,
}: {
  organizationId: string;
  /** One figure per (day, provider). Empty renders nothing. */
  rows: readonly GovernanceCostProviderDayRowDto[];
}) {
  const [opened, setOpened] = useState<{
    day: string;
    provider: string;
  } | null>(null);

  if (rows.length === 0) return null;

  const days = [...new Set(rows.map((row) => row.day))].sort();
  const providers = [...new Set(rows.map((row) => row.provider))].sort();
  const figureAt = (provider: string, day: string) =>
    rows.find((row) => row.provider === provider && row.day === day) ?? null;

  return (
    <VStack
      align="stretch"
      gap={3}
      width="full"
      aria-label="Cost by provider and day"
    >
      {providers.map((provider) => {
        // A provider whose window total was withheld still has days that each
        // hold a real number, so a reader who adds the bars up rebuilds
        // exactly the partial sum the total refused to show them. Saying so on
        // the row is what stops the row from BEING that sum.
        const partial = rows.some(
          (row) => row.provider === provider && row.amountUsd === null,
        );
        return (
          <VStack align="stretch" gap={1} key={provider}>
            <HStack gap={2}>
              <Text fontSize="sm" fontWeight="medium">
                {providerName(provider)}
              </Text>
              {partial && (
                <Text
                  fontSize="xs"
                  color="fg.muted"
                  aria-label="This provider's row covers only part of what was spent"
                >
                  Part of this provider's spend has no dollar figure
                </Text>
              )}
            </HStack>
            <HStack gap={2} wrap="wrap">
              {days.map((day) => {
                const figure = figureAt(provider, day);
                if (!figure) return null;
                return (
                  <ProviderDayFigure
                    key={day}
                    day={day}
                    provider={provider}
                    amountUsd={figure.amountUsd}
                    onOpen={() => setOpened({ day, provider })}
                  />
                );
              })}
            </HStack>
          </VStack>
        );
      })}
      {opened && (
        <DayRecords
          organizationId={organizationId}
          day={opened.day}
          provider={opened.provider}
        />
      )}
    </VStack>
  );
}

/**
 * One (day, provider) figure, and the control that opens what is behind it.
 *
 * A withheld figure renders as an em dash and is still openable: the records
 * are exactly what a reader needs when the total will not state itself, and
 * closing that door would leave them with a blank and no way to look.
 *
 * The accessible name carries the provider, the day and what the control does,
 * because the visible text is the amount alone. A row is a wall of these, two
 * days at one provider routinely cost the same, and a screen-reader user
 * moving through them by control would otherwise hear the same name several
 * times over with nothing saying which day each one opens. `title` cannot fill
 * that gap: a button with text content takes its name from the content, and
 * the title becomes a description a reader may never be given.
 *
 * A withheld figure says so in words rather than sending an em dash through a
 * speech synthesiser, which reads it as anything from silence to "dash".
 */
function ProviderDayFigure({
  day,
  provider,
  amountUsd,
  onOpen,
}: {
  day: string;
  provider: string;
  amountUsd: number | null;
  onOpen: () => void;
}) {
  const spoken =
    amountUsd === null ? "no dollar figure" : formatLaneUsd(amountUsd);
  return (
    <chakra.button
      type="button"
      onClick={onOpen}
      data-testid={`cost-provider-day-${provider}-${day}`}
      aria-label={`${providerName(provider)}, ${day}, ${spoken}. Show the records behind this day.`}
      title={day}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      paddingX={2}
      paddingY={1}
      fontSize="sm"
      fontVariantNumeric="tabular-nums"
    >
      {formatLaneUsd(amountUsd)}
    </chakra.button>
  );
}

/**
 * What one day at one provider was made of: what each record was for, and what
 * it cost.
 *
 * Mounted only once a reader opens a day, so the read is issued when it is
 * asked for rather than on every page load. This screen is read while a
 * decision is being made, so it never re-reads on its own — the rule is stated
 * here at the call site rather than inherited, exactly as the reads above it
 * state it.
 */
function DayRecords({
  organizationId,
  day,
  provider,
}: {
  organizationId: string;
  day: string;
  provider: string;
}) {
  const records = api.governanceCost.dayRecords.useQuery(
    { organizationId, day, provider },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const rows = records.data?.records ?? null;

  return (
    <VStack
      align="stretch"
      gap={1}
      aria-label="Records behind this day"
      borderTopWidth="1px"
      borderColor="border.subtle"
      paddingTop={2}
    >
      <Text fontSize="xs" color="fg.muted">
        {providerName(provider)} · {day}
      </Text>
      {/*
        A failed read and a read still in flight both leave `rows` null, and
        the screen this panel opens inside holds that the two must never look
        alike: an empty answer is a finding, a failed read is something to try
        again. So the failure is asked about first.
      */}
      {records.isError ? (
        <Text fontSize="sm" color="fg.muted">
          This day could not be read. Refresh to try again.
        </Text>
      ) : rows === null ? (
        <Text fontSize="sm" color="fg.muted">
          Reading what this day was made of.
        </Text>
      ) : rows.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          This day holds no records at this provider.
        </Text>
      ) : (
        rows.map((record) => (
          <HStack key={record.label} justify="space-between" gap={3}>
            <Text fontSize="sm">{record.label}</Text>
            <Text fontSize="sm" fontVariantNumeric="tabular-nums">
              {formatLaneUsd(record.amountUsd)}
            </Text>
          </HStack>
        ))
      )}
    </VStack>
  );
}
