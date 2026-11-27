import { Card } from "@langwatch/design-system/card";
import {
  Badge,
  Button,
  Collapsible,
  Grid,
  HStack,
  List,
  RadioCard,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { StatusChip } from "@langwatch/design-system/settings-card";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import {
  ESSENTIAL_FINDS,
  ESSENTIAL_MISSES,
  type OrganizationPiiLevel,
  PII_REDACTION_MODEL_NAME,
  STRICT_ACCEPTANCE_NOTE,
  STRICT_BILLED_NOTE,
  STRICT_GAPS,
  STRICT_RULE_BASED_BADGE,
  SWITCH_TO_MODEL_LABEL,
} from "../../model/pii-redaction-level-offer.ts";
import { PiiRedactionExample } from "../elements/pii-redaction-example.tsx";
import { PiiRedactionModelPrice } from "../elements/pii-redaction-model-price.tsx";

const LEVEL_LABELS: Record<OrganizationPiiLevel, string> = {
  essential: "Essential",
  strict: "Strict",
};

function isOrganizationPiiLevel(value: string | null): value is OrganizationPiiLevel {
  return value === "essential" || value === "strict";
}

/** What Strict can still miss, folded under the example. */
function StrictGaps() {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger
        display="flex"
        alignItems="center"
        gap={1}
        fontSize="xs"
        fontWeight="600"
        color="fg.muted"
        cursor="pointer"
        _hover={{ color: "fg" }}
        css={{ "&[data-state=open] > svg": { transform: "rotate(90deg)" } }}
      >
        <ChevronRight size={14} />
        What it can still miss
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Text fontSize="xs" color="fg.muted" paddingTop={2} paddingLeft={5}>
          {STRICT_GAPS}
        </Text>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/** One level as a radio card: its name, what sits beside it, a subtitle and what it does. */
function LevelCard({
  value,
  titleBadge,
  aside,
  subtitle,
  price,
  action,
  points,
}: {
  value: OrganizationPiiLevel;
  /** Beside the name: what the level runs today, when that is not what the card offers. */
  titleBadge?: ReactNode;
  aside: ReactNode;
  subtitle: string;
  price?: ReactNode;
  /** Under the price: the one step that changes what the level runs. */
  action?: ReactNode;
  points: string[];
}) {
  return (
    <RadioCard.Item value={value}>
      <RadioCard.ItemHiddenInput />
      <RadioCard.ItemControl>
        <RadioCard.ItemContent>
          <HStack width="full">
            <RadioCard.ItemText>{LEVEL_LABELS[value]}</RadioCard.ItemText>
            {titleBadge}
            <Spacer />
            {aside}
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {subtitle}
          </Text>
          {price}
          {action}
          <List.Root paddingLeft={4} fontSize="sm" color="fg.muted" gap={0.5}>
            {points.map((point) => (
              <List.Item key={point}>{point}</List.Item>
            ))}
          </List.Root>
        </RadioCard.ItemContent>
        <RadioCard.ItemIndicator />
      </RadioCard.ItemControl>
    </RadioCard.Item>
  );
}

/**
 * The switch to the model on a rule-based Strict card. A button inside the card's label would
 * also pick the card, so the click stops here.
 */
function SwitchToModelButton({ disabled, onSwitch }: { disabled: boolean; onSwitch: () => void }) {
  return (
    <Button
      size="xs"
      variant="outline"
      alignSelf="start"
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSwitch();
      }}
    >
      {SWITCH_TO_MODEL_LABEL}
    </Button>
  );
}

/**
 * Essential and Strict side by side; Strict carries the model, its price and the New badge, and
 * while it is rule-based until an admin accepts the price, says so and offers the switch.
 */
function LevelCards({
  free,
  licensed,
  split,
  ruleBased,
  isSaving,
  onSwitchToModel,
}: {
  free: boolean;
  licensed: boolean;
  split: boolean;
  ruleBased: boolean;
  isSaving: boolean;
  onSwitchToModel?: (() => void) | undefined;
}) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={3}>
      <LevelCard
        value="essential"
        aside={
          <Text fontSize="xs" color="fg.muted">
            Included
          </Text>
        }
        subtitle="Standard detection"
        points={[ESSENTIAL_FINDS, ESSENTIAL_MISSES, "Instant"]}
      />
      <LevelCard
        value="strict"
        titleBadge={
          ruleBased ? (
            <Badge size="sm" variant="outline" colorPalette="gray">
              {STRICT_RULE_BASED_BADGE}
            </Badge>
          ) : undefined
        }
        aside={
          <Badge size="sm" variant="solid" colorPalette="orange">
            New
          </Badge>
        }
        subtitle={PII_REDACTION_MODEL_NAME}
        price={<PiiRedactionModelPrice free={free} licensed={licensed} split={split} />}
        action={
          ruleBased && onSwitchToModel ? (
            <SwitchToModelButton disabled={isSaving} onSwitch={onSwitchToModel} />
          ) : undefined
        }
        points={[
          "Names and full street addresses in 8 languages",
          "Plus everything Essential finds",
          "Adds a few seconds before a trace shows redacted",
        ]}
      />
    </Grid>
  );
}

/** What the picked level stores, with what Strict can still miss. */
function LevelExample({ level }: { level: OrganizationPiiLevel }) {
  return (
    <Card variant="nested" padding="md">
      <VStack align="stretch" gap={3}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted">
          What {LEVEL_LABELS[level]} stores, on a synthetic span
        </Text>
        <PiiRedactionExample level={level} />
        <StrictGaps />
      </VStack>
    </Card>
  );
}

/**
 * A click the picker does not apply yet (it asks first) still checks the native radio; this puts
 * the radios assistive tech reads back on the shown level once the question is settled.
 */
function useNativeRadiosAt({
  level,
  pendingLevel,
}: {
  level: OrganizationPiiLevel | null;
  pendingLevel: OrganizationPiiLevel | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pendingLevel) return;
    for (const radio of container.current?.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    ) ?? []) {
      radio.checked = radio.value === level;
    }
  }, [level, pendingLevel]);
  return container;
}

/**
 * The organization's PII level, Essential or Strict, with the example of what the shown level
 * stores. `level` null means the organization is on Off or Custom, named by `otherLevelLabel`.
 * `pendingLevel` is a pick awaiting confirmation; the radios keep showing `level` meanwhile.
 */
export function OrganizationPiiLevelPicker({
  level,
  pendingLevel,
  otherLevelLabel,
  free,
  licensed = false,
  split = false,
  awaitingAcceptance = false,
  strictRuleShown = false,
  canWrite,
  isSaving,
  onPick,
  onSwitchToModel,
}: {
  level: OrganizationPiiLevel | null;
  pendingLevel: OrganizationPiiLevel | null;
  otherLevelLabel: string;
  free: boolean;
  /** Self-hosted: included with the Enterprise licence rather than for the organization. */
  licensed?: boolean;
  /** Long spans go to the model in parts (ADR-207): the small print names the split limit. */
  split?: boolean;
  /** Strict is rule-based, at no charge, until an organization admin accepts the price. */
  awaitingAcceptance?: boolean;
  /** A team or project rule sets Strict, so Strict is in use with the organization on Essential. */
  strictRuleShown?: boolean;
  canWrite: boolean;
  isSaving: boolean;
  onPick: (level: OrganizationPiiLevel) => void;
  /** Present only for a reader who may accept the price. */
  onSwitchToModel?: (() => void) | undefined;
}) {
  const ruleBased = level === "strict" && awaitingAcceptance;
  // Any Strict the page shows offers the switch: an admin has no other place to accept it.
  const strictRuleBased = awaitingAcceptance && (level === "strict" || strictRuleShown);
  const currentLabel = level
    ? `${LEVEL_LABELS[level]}${ruleBased ? " (rule-based)" : ""}`
    : otherLevelLabel;
  const radios = useNativeRadiosAt({ level, pendingLevel });
  return (
    <SettingsSection
      divided={false}
      title="PII redaction level for this organization"
      badge={
        <StatusChip
          tone={level === "strict" ? "good" : "neutral"}
          label={`Organization on ${currentLabel}`}
        />
      }
      hint={
        level
          ? "Rules inherit this unless they set their own level."
          : `Rules inherit ${currentLabel} unless they set their own level. Pick Essential or Strict to replace it.`
      }
    >
      <VStack align="stretch" gap={3} width="full" ref={radios}>
        <RadioCard.Root
          variant="outline"
          colorPalette="orange"
          value={level}
          disabled={!canWrite || isSaving}
          aria-label="PII redaction level for this organization"
          onValueChange={(details) => {
            if (isOrganizationPiiLevel(details.value) && details.value !== level) {
              onPick(details.value);
            }
          }}
        >
          <LevelCards
            free={free}
            licensed={licensed}
            split={split}
            ruleBased={strictRuleBased}
            isSaving={isSaving}
            onSwitchToModel={onSwitchToModel}
          />
        </RadioCard.Root>
        {level && <LevelExample level={level} />}
        {level === "strict" && !free && (
          <Text fontSize="xs" color="fg.muted">
            {awaitingAcceptance ? STRICT_ACCEPTANCE_NOTE : STRICT_BILLED_NOTE}
          </Text>
        )}
      </VStack>
    </SettingsSection>
  );
}
