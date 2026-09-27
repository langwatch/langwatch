import { Box, Button, HStack, RadioGroup, Text, VStack } from "@chakra-ui/react";
import type { PiiLevel } from "@langwatch/data-privacy-contract";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { HelpCircle, Plus } from "lucide-react";

import { PII_VALUE_LABELS } from "../../model/data-privacy-labels.ts";
import { secretPatternError } from "../../model/data-privacy-patterns.ts";
import type { PiiChoice, RuleFormState } from "../../model/data-privacy-rule-config.ts";
import {
  ESSENTIAL_PII_ENTITY_LABELS,
  ESSENTIAL_PII_SUMMARY,
  STRICT_ADDED_PII_ENTITY_LABELS,
  STRICT_ADDED_PII_SUMMARY,
} from "../../model/pii-entity-labels.ts";
import { PatternListField } from "../elements/pattern-list-field.tsx";
import { PiiEntityToggleGroup } from "../elements/pii-entity-toggle-group.tsx";

type PiiFields = Pick<RuleFormState, "piiChoice" | "piiEntities" | "piiExceptPatterns">;

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
  onChange,
}: {
  form: PiiFields;
  inheritedLevel: PiiLevel;
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

  return (
    <VStack gap={2} align="stretch">
      <VStack align="start" gap={0}>
        <Text fontWeight="600" fontSize="sm">
          PII redaction
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Masks personal data like emails, phones, cards, and IDs in stored content.
        </Text>
      </VStack>
      <RadioGroup.Root
        value={form.piiChoice}
        onValueChange={(details) => choose((details.value as PiiChoice) ?? "inherit")}
      >
        <VStack align="start" gap={1}>
          <RadioGroup.Item value="inherit">
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator />
            <RadioGroup.ItemText>
              Inherit
              {form.piiChoice === "inherit" && (
                <Text as="span" color="fg.muted">
                  {" · "}
                  {PII_VALUE_LABELS[inheritedLevel]}
                </Text>
              )}
            </RadioGroup.ItemText>
          </RadioGroup.Item>
          <RadioGroup.Item value="disabled">
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator />
            <RadioGroup.ItemText>Off</RadioGroup.ItemText>
          </RadioGroup.Item>
          <RadioGroup.Item value="essential">
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator />
            <RadioGroup.ItemText>
              Essential (emails, phones, cards, IPs, national IDs)
            </RadioGroup.ItemText>
            <HelpTip content={`Detects and masks: ${ESSENTIAL_PII_SUMMARY}.`} />
          </RadioGroup.Item>
          <RadioGroup.Item value="strict">
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator />
            <RadioGroup.ItemText>Strict (adds names, locations, and more)</RadioGroup.ItemText>
            <HelpTip
              content={`Everything in Essential, plus deeper detection of: ${STRICT_ADDED_PII_SUMMARY}.`}
            />
          </RadioGroup.Item>
          <RadioGroup.Item value="custom">
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator />
            <RadioGroup.ItemText>Custom (choose exactly what to redact)</RadioGroup.ItemText>
          </RadioGroup.Item>
        </VStack>
      </RadioGroup.Root>
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
