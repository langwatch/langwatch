import { Card } from "@langwatch/design-system/card";
import {
  Badge,
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
  STRICT_BILLED_NOTE,
  STRICT_GAPS,
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
  aside,
  subtitle,
  price,
  points,
}: {
  value: OrganizationPiiLevel;
  aside: ReactNode;
  subtitle: string;
  price?: ReactNode;
  points: string[];
}) {
  return (
    <RadioCard.Item value={value}>
      <RadioCard.ItemHiddenInput />
      <RadioCard.ItemControl>
        <RadioCard.ItemContent>
          <HStack width="full">
            <RadioCard.ItemText>{LEVEL_LABELS[value]}</RadioCard.ItemText>
            <Spacer />
            {aside}
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {subtitle}
          </Text>
          {price}
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

/** Essential and Strict side by side; Strict carries the model, its price and the New badge. */
function LevelCards({ free }: { free: boolean }) {
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
        aside={
          <Badge size="sm" variant="solid" colorPalette="orange">
            New
          </Badge>
        }
        subtitle={PII_REDACTION_MODEL_NAME}
        price={<PiiRedactionModelPrice free={free} />}
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
  canWrite,
  isSaving,
  onPick,
}: {
  level: OrganizationPiiLevel | null;
  pendingLevel: OrganizationPiiLevel | null;
  otherLevelLabel: string;
  free: boolean;
  canWrite: boolean;
  isSaving: boolean;
  onPick: (level: OrganizationPiiLevel) => void;
}) {
  const currentLabel = level ? LEVEL_LABELS[level] : otherLevelLabel;
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
          <LevelCards free={free} />
        </RadioCard.Root>
        {level && <LevelExample level={level} />}
        {level === "strict" && !free && (
          <Text fontSize="xs" color="fg.muted">
            {STRICT_BILLED_NOTE}
          </Text>
        )}
      </VStack>
    </SettingsSection>
  );
}
