import { Field, HStack, Input, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { useMemo } from "react";

import {
  earliestCustomDate,
  formatExpiry,
  resolveExpiresAt,
  VIRTUAL_KEY_EXPIRATION_OPTIONS,
  type VirtualKeyExpirationPreset,
} from "../../model/virtual-key-expiration.ts";

export type VirtualKeyExpirationValue = {
  preset: VirtualKeyExpirationPreset;
  /** A `yyyy-mm-dd` value, only read when the preset is "custom". */
  customDate: string;
};

export const NEVER_EXPIRES: VirtualKeyExpirationValue = {
  preset: "",
  customDate: "",
};

/**
 * The expiration block both virtual-key drawers end with. One component,
 * not two copies: create and edit resolve the same period through the same
 * rules, and the resolved date is stated back so "6 months" is never a guess.
 */
export function VirtualKeyExpirationSection({
  value,
  onChange,
  fieldError,
}: {
  value: VirtualKeyExpirationValue;
  onChange: (next: VirtualKeyExpirationValue) => void;
  /** A server complaint about this field, rendered where the field is. */
  fieldError?: string | null;
}) {
  const resolved = useMemo(
    () => resolveExpiresAt({ preset: value.preset, customDate: value.customDate }),
    [value.preset, value.customDate],
  );
  // Recomputed every render, not memoised: the floor tracks the clock while
  // the drawer stays open. It sits a day ahead to absorb a UTC-day boundary,
  // so only a drawer left open over a day could name an already-gone date
  // (refused as virtual_key_expiry_in_past); any interaction re-renders it.
  const minDate = earliestCustomDate();

  const unresolvedSummary =
    value.preset === "custom" ? "Pick the last day this key works." : "This key never expires.";

  return (
    <VStack align="stretch" gap={2}>
      <HStack>
        <Text fontSize="sm" fontWeight="semibold">
          Expiration
        </Text>
        <FieldInfoTooltip
          description="After this date the key stops serving and its requests are refused with a distinct 'expired' error. The key itself is untouched: extending the date here puts it back in service with the same secret, so a temporary key never has to be re-issued. Leave it on Never for a key that should keep working."
          docHref="/ai-gateway/virtual-keys#expiration-the-stop-nobody-presses"
          testId="vk-expiration-info"
        />
      </HStack>
      <HStack gap={4} align="flex-start">
        <Field.Root flex={1} invalid={!!fieldError}>
          <Field.Label>Expires</Field.Label>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              data-testid="vk-expiration-preset"
              value={value.preset}
              onChange={(e) =>
                onChange({
                  ...value,
                  preset: e.target.value as VirtualKeyExpirationPreset,
                })
              }
            >
              {VIRTUAL_KEY_EXPIRATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect.Field>
          </NativeSelect.Root>
          {fieldError && <Field.ErrorText>{fieldError}</Field.ErrorText>}
        </Field.Root>
        {value.preset === "custom" && (
          <Field.Root flex={1}>
            <Field.Label>Date</Field.Label>
            <Input
              type="date"
              size="sm"
              data-testid="vk-expiration-date"
              min={minDate}
              value={value.customDate}
              onChange={(e) => onChange({ ...value, customDate: e.target.value })}
            />
          </Field.Root>
        )}
      </HStack>
      <Text fontSize="xs" color="fg.muted" data-testid="vk-expiration-resolved">
        {resolved ? `Expires ${formatExpiry(resolved)}` : unresolvedSummary}
      </Text>
    </VStack>
  );
}
