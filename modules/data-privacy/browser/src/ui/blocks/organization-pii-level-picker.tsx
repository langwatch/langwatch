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

import {
  ESSENTIAL_FINDS,
  ESSENTIAL_MISSES,
  type OrganizationPiiLevel,
  PII_REDACTION_MODEL_NAME,
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

/**
 * The organization's PII level, Essential or Strict, with the example of what the shown level
 * stores. `level` null means the organization is on Off or Custom, named by `otherLevelLabel`.
 */
export function OrganizationPiiLevelPicker({
  level,
  otherLevelLabel,
  free,
  canWrite,
  isSaving,
  onPick,
}: {
  level: OrganizationPiiLevel | null;
  otherLevelLabel: string;
  free: boolean;
  canWrite: boolean;
  isSaving: boolean;
  onPick: (level: OrganizationPiiLevel) => void;
}) {
  const disabled = !canWrite || isSaving;
  const currentLabel = level ? LEVEL_LABELS[level] : otherLevelLabel;
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
      <VStack align="stretch" gap={3} width="full">
        <RadioCard.Root
          variant="outline"
          colorPalette="orange"
          value={level}
          disabled={disabled}
          aria-label="PII redaction level for this organization"
          onValueChange={(details) => {
            if (isOrganizationPiiLevel(details.value) && details.value !== level) {
              onPick(details.value);
            }
          }}
        >
          <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={3}>
            <RadioCard.Item value="essential">
              <RadioCard.ItemHiddenInput />
              <RadioCard.ItemControl>
                <RadioCard.ItemContent>
                  <HStack width="full">
                    <RadioCard.ItemText>Essential</RadioCard.ItemText>
                    <Spacer />
                    <Text fontSize="xs" color="fg.muted">
                      Included
                    </Text>
                  </HStack>
                  <Text fontSize="xs" color="fg.muted">
                    Standard detection
                  </Text>
                  <List.Root paddingLeft={4} fontSize="sm" color="fg.muted" gap={0.5}>
                    <List.Item>{ESSENTIAL_FINDS}</List.Item>
                    <List.Item>{ESSENTIAL_MISSES}</List.Item>
                    <List.Item>Instant</List.Item>
                  </List.Root>
                </RadioCard.ItemContent>
                <RadioCard.ItemIndicator />
              </RadioCard.ItemControl>
            </RadioCard.Item>
            <RadioCard.Item value="strict">
              <RadioCard.ItemHiddenInput />
              <RadioCard.ItemControl>
                <RadioCard.ItemContent>
                  <HStack width="full">
                    <RadioCard.ItemText>Strict</RadioCard.ItemText>
                    <Spacer />
                    <Badge size="sm" variant="solid" colorPalette="orange">
                      New
                    </Badge>
                  </HStack>
                  <Text fontSize="xs" color="fg.muted">
                    {PII_REDACTION_MODEL_NAME}
                  </Text>
                  <PiiRedactionModelPrice free={free} />
                  <List.Root paddingLeft={4} fontSize="sm" color="fg.muted" gap={0.5}>
                    <List.Item>Names and full street addresses in 8 languages</List.Item>
                    <List.Item>Plus everything Essential finds</List.Item>
                    <List.Item>Adds a few seconds before a trace shows redacted</List.Item>
                  </List.Root>
                </RadioCard.ItemContent>
                <RadioCard.ItemIndicator />
              </RadioCard.ItemControl>
            </RadioCard.Item>
          </Grid>
        </RadioCard.Root>
        {level && (
          <Card variant="nested" padding="md">
            <VStack align="stretch" gap={3}>
              <Text fontSize="xs" fontWeight="600" color="fg.muted">
                What {LEVEL_LABELS[level]} stores, on a synthetic span
              </Text>
              <PiiRedactionExample level={level} />
              <StrictGaps />
            </VStack>
          </Card>
        )}
        {level === "strict" && !free && (
          <Text fontSize="xs" color="fg.muted">
            Strict is billed from the next trace. Pick Essential to stop it.
          </Text>
        )}
      </VStack>
    </SettingsSection>
  );
}
