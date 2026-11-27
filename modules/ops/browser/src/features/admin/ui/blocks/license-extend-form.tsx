import { Button, Field, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { useState } from "react";

import {
  dayOf,
  EXTEND_PRESETS,
  extendProblem,
  presetEnd,
  type ExtendPreset,
} from "../../model/extend-term.ts";
import { formatDay } from "../../model/license-chain.ts";
import { dateInputToISO } from "../elements/admin-cells.tsx";

/** Picks the new end of the term; the seats and services stay as they are. */
export function LicenseExtendForm({
  expiresAt,
  inUseEndsAt,
  install,
  isSaving,
  onCancel,
  onExtend,
}: {
  expiresAt: string;
  /** When the license the install runs today ends; it keeps working until the replacement lands. */
  inUseEndsAt: string;
  /** The install that picks the replacement up, or null when none is bound. */
  install: string | null;
  isSaving: boolean;
  onCancel: () => void;
  onExtend: (expiresAt: string) => void;
}) {
  const [newEnd, setNewEnd] = useState(() => presetEnd({ expiresAt, preset: EXTEND_PRESETS[0] }));
  const problem = extendProblem({ expiresAt, newEnd });
  const submitted = problem === undefined ? dateInputToISO(newEnd) : null;
  const picked = submitted ? formatDay(submitted) : null;
  const isPreset = (preset: ExtendPreset) => presetEnd({ expiresAt, preset }) === newEnd;

  return (
    <VStack
      align="stretch"
      gap={3}
      padding={3}
      borderRadius="md"
      bg="bg.subtle"
      data-testid="extend-term-form"
    >
      <HStack gap={2} wrap="wrap">
        {EXTEND_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            size="xs"
            variant={isPreset(preset) ? "solid" : "outline"}
            aria-pressed={isPreset(preset)}
            onClick={() => setNewEnd(presetEnd({ expiresAt, preset }))}
          >
            {preset.label}
          </Button>
        ))}
      </HStack>
      <HStack gap={3} align="start">
        <Field.Root flex={1} invalid={problem !== undefined}>
          <Field.Label>New end date</Field.Label>
          <Input
            type="date"
            min={dayOf(expiresAt)}
            value={newEnd}
            onChange={(event) => setNewEnd(event.target.value)}
          />
          <Field.ErrorText>{problem}</Field.ErrorText>
        </Field.Root>
        <Field.Root flex={1}>
          <Field.Label>Seats and services</Field.Label>
          <Input readOnly value="Same as today" />
        </Field.Root>
      </HStack>
      <Text fontSize="sm" color="fg.muted">
        {install
          ? `Signs a replacement that ends ${picked ?? "on the new date"}. ${install} picks it up on its next sync, nothing to send. The ${formatDay(inUseEndsAt)} license keeps working until then.`
          : `Signs a new key that ends ${picked ?? "on the new date"}. No install has used this license, so you send the new key and the unused one stops working.`}
      </Text>
      <HStack gap={2} justify="end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={problem !== undefined}
          loading={isSaving}
          onClick={() => {
            if (submitted) onExtend(submitted);
          }}
        >
          {picked ? `Extend to ${picked}` : "Extend"}
        </Button>
      </HStack>
    </VStack>
  );
}
