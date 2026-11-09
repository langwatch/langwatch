/**
 * The decision models a refused Instant Eval can run on, picked in place: the project's own models
 * the server says would run lead, the rest of the own-key catalogue waits behind "More models".
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */
import { Link as RoutedLink } from "@langwatch/browser-host/link";
import { Box, chakra, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { modelProviderIcons, ProviderIconGlyph } from "@langwatch/design-system/provider-icons";
import {
  DECISION_MODELS,
  type DecisionModelEntry,
  decisionModelPickerTitle,
  findDecisionModel,
} from "@langwatch/model-provider-contract";
import { ChevronDown, Layers3, SlidersHorizontal, Sparkles } from "lucide-react";
import { useState } from "react";

type ProviderKey = keyof typeof modelProviderIcons;

export interface DecisionModelPickerRow {
  value: string;
  label: string;
  provider: string;
}

/**
 * Suggested: what the server would run, LangWatch's own model left out. More: every other own-key
 * model, which needs its provider's key first.
 */
export function decisionModelPickerRows(pickable: readonly { value: string; label: string }[]): {
  suggested: DecisionModelPickerRow[];
  more: DecisionModelPickerRow[];
} {
  const rowOf = (entry: DecisionModelEntry): DecisionModelPickerRow => ({
    value: entry.id,
    label: decisionModelPickerTitle(entry),
    provider: entry.provider,
  });
  const own = (id: string) => findDecisionModel(id)?.provider !== "langwatch";
  const offered = new Set(pickable.map((model) => model.value).filter(own));
  const suggested = pickable
    .filter((model) => offered.has(model.value))
    .map((model) => {
      const entry = findDecisionModel(model.value);
      return entry ? rowOf(entry) : { ...model, provider: model.value.split("/")[0] ?? "" };
    });
  const more = DECISION_MODELS.filter((entry) => own(entry.id) && !offered.has(entry.id)).map(
    rowOf,
  );
  return { suggested, more };
}

export function DecisionModelPicker({
  pickable,
  onPick,
  picking,
  configureHref,
}: {
  /** The server's answer; undefined while it loads. */
  pickable: readonly { value: string; label: string }[] | undefined;
  onPick: (model: string) => void;
  /** The model being saved, so its row spins and the rest wait. */
  picking: string | null;
  configureHref: string;
}) {
  const [showMore, setShowMore] = useState(false);
  if (!pickable) {
    return (
      <HStack gap={2} color="fg.muted" paddingY={2}>
        <Spinner size="xs" />
        <Text textStyle="xs">Loading models</Text>
      </HStack>
    );
  }
  const { suggested, more } = decisionModelPickerRows(pickable);
  const moreOpen = showMore || suggested.length === 0;
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      overflow="hidden"
      data-testid="decision-model-picker"
    >
      <VStack align="stretch" gap={0} padding={1} maxHeight="240px" overflowY="auto">
        {suggested.length > 0 && (
          <>
            <GroupLabel>
              <Sparkles size={11} />
              Suggested
            </GroupLabel>
            {suggested.map((row) => (
              <ModelRow
                key={row.value}
                row={row}
                onClick={() => onPick(row.value)}
                busy={picking === row.value}
                disabled={picking !== null}
              />
            ))}
            {more.length > 0 && (
              <chakra.button
                type="button"
                onClick={() => setShowMore((open) => !open)}
                aria-expanded={moreOpen}
                display="flex"
                alignItems="center"
                gap={1.5}
                paddingX={2}
                paddingY={1.5}
                borderRadius="md"
                color="fg.muted"
                cursor="pointer"
                _hover={{ background: "bg.subtle", color: "fg" }}
              >
                <Box transition="transform 160ms ease" transform={moreOpen ? "rotate(180deg)" : ""}>
                  <ChevronDown size={12} />
                </Box>
                <Text textStyle="2xs" fontWeight="500">
                  {moreOpen ? "Fewer models" : "More models"}
                </Text>
                <Text textStyle="2xs" color="fg.subtle">
                  {more.length}
                </Text>
              </chakra.button>
            )}
          </>
        )}
        {moreOpen &&
          more.map((row) => <ModelRow key={row.value} row={row} hint="Add key" disabled />)}
      </VStack>
      <RoutedLink
        href={configureHref}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="decision-model-picker-configure"
        style={{ textDecoration: "none" }}
      >
        <HStack
          gap={1.5}
          paddingX={3}
          paddingY={2}
          borderTopWidth="1px"
          borderColor="border.muted"
          color="fg.muted"
          _hover={{ background: "bg.subtle", color: "fg" }}
        >
          <SlidersHorizontal size={12} />
          <Text textStyle="2xs" fontWeight="500">
            Configure available models
          </Text>
        </HStack>
      </RoutedLink>
    </Box>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <HStack gap={1.5} paddingX={2} paddingTop={1.5} paddingBottom={1} color="fg.subtle">
      <Text
        as="span"
        display="inline-flex"
        alignItems="center"
        gap={1.5}
        textStyle="2xs"
        fontWeight="600"
        textTransform="uppercase"
        letterSpacing="0.07em"
      >
        {children}
      </Text>
    </HStack>
  );
}

function ModelRow({
  row,
  onClick,
  busy = false,
  disabled = false,
  hint,
}: {
  row: DecisionModelPickerRow;
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const hasIcon = row.provider in modelProviderIcons;
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={`decision-model-option-${row.value}`}
      display="flex"
      alignItems="center"
      gap={2}
      width="full"
      paddingX={2}
      paddingY={1.5}
      borderRadius="md"
      textAlign="left"
      cursor={disabled ? "default" : "pointer"}
      opacity={hint ? 0.55 : 1}
      _hover={disabled ? undefined : { background: "bg.subtle" }}
    >
      <Box flexShrink={0} display="grid" placeItems="center" color="fg.subtle">
        {hasIcon ? (
          <ProviderIconGlyph provider={row.provider as ProviderKey} size="15px" />
        ) : (
          <Layers3 size={15} />
        )}
      </Box>
      <Text textStyle="sm" flex={1} minWidth={0} truncate>
        {row.label}
      </Text>
      {busy && <Spinner size="xs" />}
      {hint && (
        <Text textStyle="2xs" color="fg.subtle" whiteSpace="nowrap">
          {hint}
        </Text>
      )}
    </chakra.button>
  );
}
