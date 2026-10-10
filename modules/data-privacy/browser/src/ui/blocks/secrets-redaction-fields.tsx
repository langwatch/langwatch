import {
  Box,
  Button,
  createListCollection,
  HStack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Plus } from "lucide-react";

import { inheritedHint } from "../../model/data-privacy-labels.ts";
import { customSecretPatternError } from "../../model/data-privacy-patterns.ts";
import type { RuleFormState, SecretsChoice } from "../../model/data-privacy-rule-config.ts";
import { PatternListField } from "../elements/pattern-list-field.tsx";

const secretsChoiceCollection = createListCollection({
  items: [
    { value: "inherit", label: "Inherit" },
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ],
});

type SecretsFields = Pick<RuleFormState, "secretsChoice" | "secretsPatterns">;

/** Secrets redaction on, off or inherited, plus the custom patterns an enabled rule adds. */
export function SecretsRedactionFields({
  form,
  inheritedEnabled,
  onChange,
}: {
  form: SecretsFields;
  inheritedEnabled: boolean;
  onChange: (patch: Partial<SecretsFields>) => void;
}) {
  const patterns = form.secretsPatterns;
  return (
    <VStack gap={2} align="stretch">
      <HStack justifyContent="space-between" gap={4} align="start">
        <VStack align="start" gap={0}>
          <Text fontWeight="600" fontSize="sm">
            Secrets redaction
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Scrubs API keys, tokens, private keys, and database URLs. On by default.
          </Text>
        </VStack>
        <Select.Root
          collection={secretsChoiceCollection}
          value={[form.secretsChoice]}
          size="sm"
          width="120px"
          onValueChange={(details) =>
            onChange({ secretsChoice: (details.value[0] as SecretsChoice) ?? "inherit" })
          }
        >
          <Select.Trigger background="bg" aria-label="Secrets redaction">
            <Select.ValueText />
          </Select.Trigger>
          <Select.Content>
            {secretsChoiceCollection.items.map((item) => (
              <Select.Item key={item.value} item={item}>
                {item.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </HStack>
      {form.secretsChoice === "inherit" && (
        <Text fontSize="xs" color="fg.muted" textAlign="end">
          {inheritedHint(inheritedEnabled ? "On" : "Off")}
        </Text>
      )}
      {form.secretsChoice === "on" && (
        <VStack gap={2} align="stretch" paddingLeft={6}>
          {patterns.length > 0 && (
            <Text fontWeight="600" fontSize="sm">
              Custom patterns
            </Text>
          )}
          <PatternListField
            patterns={patterns}
            onChange={(secretsPatterns) => onChange({ secretsPatterns })}
            errorOf={customSecretPatternError}
            placeholder="acme_live_[a-z0-9]+"
            label="Custom secret pattern"
            removeLabel="custom secret pattern"
          />
          <Box>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onChange({ secretsPatterns: [...patterns, ""] })}
            >
              <Plus size={14} /> Add custom pattern
            </Button>
          </Box>
          <Text fontSize="xs" color="fg.muted">
            Extra regular expressions redacted on top of the built-in catalog.
          </Text>
        </VStack>
      )}
    </VStack>
  );
}
