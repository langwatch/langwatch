import { createListCollection, HStack, Text, VStack } from "@chakra-ui/react";
import {
  CONTENT_CATEGORIES,
  type ContentCategory,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { Select } from "@langwatch/design-system/select";

import {
  CATEGORY_LABELS,
  DISPOSITION_LABELS,
  inheritedHint,
} from "../../model/data-privacy-labels.ts";
import type { CategoryChoice } from "../../model/data-privacy-rule-config.ts";

const dispositionCollection = createListCollection({
  items: [
    { value: "inherit", label: "Inherit", description: "Use the value from the wider scope." },
    { value: "capture", label: "Captured", description: "Stored and visible to your team." },
    {
      value: "restrict",
      label: "Restricted",
      description: "Stored, visible only to the audience below.",
    },
    { value: "drop", label: "Dropped", description: "Stripped at ingestion, cannot be recovered." },
  ],
});

/** One disposition per content category, each showing what it inherits while left on Inherit. */
export function ContentDispositionFields({
  dispositions,
  inheritedBaseline,
  onChange,
}: {
  dispositions: Record<ContentCategory, CategoryChoice>;
  inheritedBaseline: ResolvedDataPrivacy;
  onChange: (dispositions: Record<ContentCategory, CategoryChoice>) => void;
}) {
  return (
    <VStack gap={2.5} align="stretch">
      <Text fontWeight="600" fontSize="sm">
        Content
      </Text>
      {CONTENT_CATEGORIES.map((category) => {
        const choice = dispositions[category];
        return (
          <VStack key={category} align="stretch" gap={0.5}>
            <HStack justifyContent="space-between" gap={4}>
              <Text fontSize="sm">{CATEGORY_LABELS[category]}</Text>
              <Select.Root
                collection={dispositionCollection}
                value={[choice]}
                size="sm"
                width="200px"
                onValueChange={(details) =>
                  onChange({
                    ...dispositions,
                    [category]: (details.value[0] as CategoryChoice) ?? "inherit",
                  })
                }
              >
                <Select.Trigger background="bg" aria-label={CATEGORY_LABELS[category]}>
                  <Select.ValueText />
                </Select.Trigger>
                <Select.Content>
                  {dispositionCollection.items.map((item) => (
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
            {choice === "inherit" && (
              <Text fontSize="xs" color="fg.muted" textAlign="end">
                {inheritedHint(
                  DISPOSITION_LABELS[inheritedBaseline.categories[category].disposition],
                )}
              </Text>
            )}
          </VStack>
        );
      })}
    </VStack>
  );
}
