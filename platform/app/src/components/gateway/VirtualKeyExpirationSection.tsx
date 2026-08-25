import { Field, HStack, Input, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";

import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import {
  earliestCustomDate,
  formatExpiry,
  resolveExpiresAt,
  VIRTUAL_KEY_EXPIRATION_OPTIONS,
  type VirtualKeyExpirationPreset,
} from "./virtualKeyExpiration";

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
 * The expiration block both virtual-key drawers end with.
 *
 * One component rather than two copies, because the create and edit forms
 * have to mean the same thing by the same words: the period picked here
 * resolves through the same rules on both, and the resolved date is stated
 * back either way so nobody has to work out what "6 months" lands on.
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
  // Recomputed every render rather than memoised once, so the floor tracks
  // the clock while the drawer stays open. The floor sits a whole day ahead,
  // which absorbs a single UTC-day boundary: the stale value then names today,
  // and today still resolves to 23:59:59.999Z, which the server accepts. It
  // takes a drawer left open for more than a day before the stale floor names
  // a date already gone, which the server refuses with
  // virtual_key_expiry_in_past. Any interaction re-renders and brings it
  // current.
  const minDate = earliestCustomDate();

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
        {resolved
          ? `Expires ${formatExpiry(resolved)}`
          : value.preset === "custom"
            ? "Pick the last day this key works."
            : "This key never expires."}
      </Text>
    </VStack>
  );
}
