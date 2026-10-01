import {
  Box,
  Button,
  createListCollection,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { HelpCircle, Plus, X } from "lucide-react";

import { attributePatternError } from "../../model/data-privacy-patterns.ts";
import type { CustomAttributeFormRow } from "../../model/data-privacy-rule-config.ts";

const attributeDispositionCollection = createListCollection({
  items: [
    { value: "restrict", label: "Restricted" },
    { value: "drop", label: "Dropped" },
  ],
});

/** Attribute-key patterns beyond the four categories, each restricted or dropped. */
export function CustomAttributeRules({
  rows,
  onChange,
}: {
  rows: CustomAttributeFormRow[];
  onChange: (rows: CustomAttributeFormRow[]) => void;
}) {
  const update = (index: number, patch: Partial<CustomAttributeFormRow>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  return (
    <VStack gap={2} align="stretch">
      <HStack gap={2}>
        <Text fontWeight="600" fontSize="sm">
          Custom attributes
        </Text>
        <Tooltip
          content="Match span attribute keys beyond the four categories, with * wildcards: restricted attributes are hidden from outside the audience, dropped ones are stripped at ingestion."
          contentProps={{ maxWidth: "340px" }}
        >
          <Box color="fg.muted" display="inline-flex">
            <HelpCircle size={13} />
          </Box>
        </Tooltip>
        <Spacer />
        <Button
          size="xs"
          variant="outline"
          onClick={() => onChange([...rows, { pattern: "", disposition: "restrict" }])}
        >
          <Plus size={14} /> Add attribute rule
        </Button>
      </HStack>
      {rows.map((row, index) => {
        const error = attributePatternError(row.pattern);
        return (
          <VStack key={index} gap={1} align="stretch">
            <HStack gap={2}>
              <Input
                size="sm"
                fontFamily="mono"
                placeholder="gen_ai.prompt.*"
                value={row.pattern}
                aria-label={`Attribute pattern ${index + 1}`}
                borderColor={error ? "red.500" : undefined}
                onChange={(event) => update(index, { pattern: event.target.value })}
              />
              <Select.Root
                collection={attributeDispositionCollection}
                value={[row.disposition]}
                size="sm"
                width="160px"
                onValueChange={(details) =>
                  update(index, {
                    disposition: (details.value[0] as "restrict" | "drop") ?? "restrict",
                  })
                }
              >
                <Select.Trigger background="bg" aria-label={`Attribute disposition ${index + 1}`}>
                  <Select.ValueText />
                </Select.Trigger>
                <Select.Content>
                  {attributeDispositionCollection.items.map((item) => (
                    <Select.Item key={item.value} item={item}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Remove attribute rule ${index + 1}`}
                onClick={() => onChange(rows.filter((_, position) => position !== index))}
              >
                <X size={14} />
              </Button>
            </HStack>
            {error && (
              <Text fontSize="xs" color="red.500">
                {error}
              </Text>
            )}
          </VStack>
        );
      })}
    </VStack>
  );
}
