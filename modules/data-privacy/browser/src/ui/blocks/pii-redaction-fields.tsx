import type { PiiLevel } from "@langwatch/data-privacy-contract";
import {
  Box,
  Button,
  createListCollection,
  HStack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { HelpCircle, Plus } from "lucide-react";

import { inheritedHint, PII_VALUE_LABELS } from "../../model/data-privacy-labels.ts";
import { secretPatternError } from "../../model/data-privacy-patterns.ts";
import type { PiiChoice, RuleFormState } from "../../model/data-privacy-rule-config.ts";
import {
  ESSENTIAL_PII_ENTITY_LABELS,
  ESSENTIAL_PII_SUMMARY,
  STRICT_ADDED_PII_ENTITY_LABELS,
  STRICT_ADDED_PII_SUMMARY,
} from "../../model/pii-entity-labels.ts";
import {
  type PiiRedactionModelOffer,
  STRICT_RULE_BASED_NOTE,
} from "../../model/pii-redaction-level-offer.ts";
import { PatternListField } from "../elements/pattern-list-field.tsx";
import { PiiEntityToggleGroup } from "../elements/pii-entity-toggle-group.tsx";
import { PiiRedactionLevelDetail } from "./pii-redaction-level-detail.tsx";

type PiiFields = Pick<RuleFormState, "piiChoice" | "piiEntities" | "piiExceptPatterns">;

const piiChoiceCollection = createListCollection<{
  value: PiiChoice;
  label: string;
  description: string;
}>({
  items: [
    { value: "inherit", label: "Inherit", description: "Use the value from the wider scope." },
    { value: "disabled", label: "Off", description: "Personal data is stored as sent." },
    {
      value: "essential",
      label: "Essential",
      description: "Emails, phones, cards, IPs, national IDs.",
    },
    { value: "strict", label: "Strict", description: "Adds names, locations, and more." },
    { value: "custom", label: "Custom", description: "Choose exactly what to redact." },
  ],
});

function HelpTip({ content }: { content: string }) {
  return (
    <Tooltip content={content} contentProps={{ maxWidth: "340px" }}>
      <Box color="fg.muted" display="inline-flex">
        <HelpCircle size={13} />
      </Box>
    </Tooltip>
  );
}

/** The PII level, the custom level's identifiers, and the exceptions any redacting level keeps. */
export function PiiRedactionFields({
  form,
  inheritedLevel,
  piiRedactionModelOffer = null,
  onChange,
}: {
  form: PiiFields;
  inheritedLevel: PiiLevel;
  /** What the level runs, Strict's price and the example; null hides them. */
  piiRedactionModelOffer?: PiiRedactionModelOffer;
  onChange: (patch: Partial<PiiFields>) => void;
}) {
  const toggleEntity = (entity: string) =>
    onChange({
      piiEntities: form.piiEntities.includes(entity)
        ? form.piiEntities.filter((candidate) => candidate !== entity)
        : [...form.piiEntities, entity],
    });

  // Custom starts from the native essentials the first time, a base the customer can pare down.
  const choose = (next: PiiChoice) =>
    onChange({
      piiChoice: next,
      ...(next === "custom" && form.piiEntities.length === 0
        ? { piiEntities: Object.keys(ESSENTIAL_PII_ENTITY_LABELS) }
        : {}),
    });

  const effectiveLevel = form.piiChoice === "inherit" ? inheritedLevel : form.piiChoice;

  return (
    <VStack gap={2} align="stretch">
      <HStack justifyContent="space-between" gap={4} align="start">
        <VStack align="start" gap={0}>
          <HStack gap={1}>
            <Text fontWeight="600" fontSize="sm">
              PII redaction
            </Text>
            <HelpTip
              content={`Essential detects: ${ESSENTIAL_PII_SUMMARY}. Strict adds deeper detection of: ${STRICT_ADDED_PII_SUMMARY}.`}
            />
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            Masks personal data like emails, phones, cards, and IDs in stored content.
          </Text>
        </VStack>
        <Select.Root
          collection={piiChoiceCollection}
          value={[form.piiChoice]}
          size="sm"
          width="200px"
          flexShrink={0}
          onValueChange={(details) => choose((details.value[0] as PiiChoice) ?? "inherit")}
        >
          <Select.Trigger background="bg" aria-label="PII redaction">
            <Select.ValueText />
          </Select.Trigger>
          <Select.Content>
            {piiChoiceCollection.items.map((item) => (
              <Select.Item key={item.value} item={item}>
                <VStack align="start" gap={0}>
                  <Text fontSize="sm">{item.label}</Text>
                  <Text fontSize="xs" color="fg.muted">
                    {item.description}
                  </Text>
                </VStack>
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </HStack>
      {form.piiChoice === "inherit" && (
        <Text fontSize="xs" color="fg.muted" textAlign="end">
          {inheritedHint(PII_VALUE_LABELS[inheritedLevel])}
        </Text>
      )}
      {piiRedactionModelOffer?.kind === "model" && (
        <PiiRedactionLevelDetail level={effectiveLevel} free={piiRedactionModelOffer.free} />
      )}
      {piiRedactionModelOffer?.kind === "rule-based" && effectiveLevel === "strict" && (
        <Text fontSize="xs" color="fg.muted">
          {STRICT_RULE_BASED_NOTE}
        </Text>
      )}
      {form.piiChoice === "custom" && (
        <VStack align="stretch" gap={3} paddingLeft={6}>
          <PiiEntityToggleGroup
            title="Fast detection"
            hint="Redacted instantly as data arrives, at no extra cost."
            labels={ESSENTIAL_PII_ENTITY_LABELS}
            selected={form.piiEntities}
            onToggle={toggleEntity}
          />
          <PiiEntityToggleGroup
            title="Deep detection"
            hint="Also finds names and locations. May add some latency."
            labels={STRICT_ADDED_PII_ENTITY_LABELS}
            selected={form.piiEntities}
            onToggle={toggleEntity}
          />
        </VStack>
      )}
      {form.piiChoice !== "inherit" && form.piiChoice !== "disabled" && (
        <PiiExceptions
          patterns={form.piiExceptPatterns}
          onChange={(piiExceptPatterns) => onChange({ piiExceptPatterns })}
        />
      )}
    </VStack>
  );
}

function PiiExceptions({
  patterns,
  onChange,
}: {
  patterns: string[];
  onChange: (patterns: string[]) => void;
}) {
  return (
    <VStack gap={2} align="stretch" paddingLeft={6}>
      <HStack gap={1}>
        {patterns.length > 0 && (
          <>
            <Text fontWeight="600" fontSize="sm">
              Exceptions
            </Text>
            <HelpTip content="A detected value that fully matches one of these regular expressions is kept as is. Use this for business identifiers that look like personal data, such as an internal reservation number detection reads as a card number. Applies to Fast detection matches; Deep detection (names, locations) can still redact a value even if it matches an exception." />
          </>
        )}
      </HStack>
      <PatternListField
        patterns={patterns}
        onChange={onChange}
        errorOf={secretPatternError}
        placeholder="00[0-9]{12}"
        label="PII exception pattern"
        removeLabel="PII exception pattern"
      />
      <Box>
        <Button size="xs" variant="ghost" onClick={() => onChange([...patterns, ""])}>
          <Plus size={14} /> Add exception
        </Button>
      </Box>
      {patterns.length === 0 && (
        <Text fontSize="xs" color="fg.muted">
          Keep known-safe formats that look like personal data, such as internal reservation
          numbers.
        </Text>
      )}
    </VStack>
  );
}
