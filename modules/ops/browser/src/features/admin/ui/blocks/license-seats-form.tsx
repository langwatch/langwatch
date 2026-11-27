import { Button, Field, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { useState } from "react";

import { developerSeatsProblem, type License } from "../../model/license-terms.ts";

export type SeatsChange =
  | { kind: "full"; maxMembers: number }
  | { kind: "developer"; maxMembersDeveloper: number };

const developerSeatsOf = (license: License) => String(license.maxMembersDeveloper ?? 0);

/** Why the typed seats cannot be sent, or undefined with the one change they make. */
function seatsChangeOf({
  license,
  full,
  developers,
}: {
  license: License;
  full: string;
  developers: string;
}): { problem?: string; developersProblem?: string; change?: SeatsChange } {
  const developersProblem =
    developers.trim() === ""
      ? "Enter the Developer seats, 0 for none."
      : developerSeatsProblem(developers);
  if (developersProblem) return { developersProblem };
  const requested = Number(full);
  if (full.trim() === "" || !Number.isInteger(requested) || requested < 1) {
    return { problem: "Enter at least 1 full seat." };
  }
  const fullChanged = requested !== license.maxMembers;
  const developersChanged = Number(developers) !== (license.maxMembersDeveloper ?? 0);
  if (fullChanged && developersChanged) {
    return { problem: "Change full seats and Developer seats one at a time." };
  }
  if (fullChanged) return { change: { kind: "full", maxMembers: requested } };
  if (developersChanged) {
    return { change: { kind: "developer", maxMembersDeveloper: Number(developers) } };
  }
  return {};
}

function saveLabel(change: SeatsChange | undefined): string {
  if (!change) return "Save seats";
  return change.kind === "full"
    ? `Change to ${change.maxMembers} seats`
    : `Change to ${change.maxMembersDeveloper} Developer seats`;
}

/** A new seat count for the same term; full seats raised are invoiced by billing. */
export function LicenseSeatsForm({
  license,
  inUse,
  install,
  isSaving,
  onCancel,
  onChange,
}: {
  license: License;
  inUse: number | null;
  install: string | null;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (change: SeatsChange) => void;
}) {
  const [full, setFull] = useState(() => String(license.maxMembers));
  const [developers, setDevelopers] = useState(() => developerSeatsOf(license));
  const { problem, developersProblem, change } = seatsChangeOf({ license, full, developers });

  return (
    <VStack
      align="stretch"
      gap={3}
      padding={3}
      borderRadius="md"
      bg="bg.subtle"
      data-testid="change-seats-form"
    >
      <HStack gap={3} align="start">
        <Field.Root flex={1} invalid={problem !== undefined}>
          <Field.Label>Full seats</Field.Label>
          <Input
            type="number"
            min={1}
            value={full}
            onChange={(event) => setFull(event.target.value)}
          />
          <Field.ErrorText>{problem}</Field.ErrorText>
        </Field.Root>
        <Field.Root flex={1} invalid={developersProblem !== undefined}>
          <Field.Label>Developer seats</Field.Label>
          <Input
            type="number"
            min={0}
            aria-invalid={developersProblem !== undefined || undefined}
            value={developers}
            onChange={(event) => setDevelopers(event.target.value)}
          />
          <Field.ErrorText>{developersProblem}</Field.ErrorText>
        </Field.Root>
        <Field.Root flex={1}>
          <Field.Label>In use now</Field.Label>
          <Input
            readOnly
            value={inUse === null ? "Not reported yet" : `${inUse} of ${license.maxMembers}`}
          />
        </Field.Root>
      </HStack>
      <Text fontSize="sm" color="fg.muted">
        {`Seats that go up are invoiced prorated to the end of the term; seats that go down are not credited. ${
          install
            ? `${install} picks up the new seats on its next sync, nothing to send.`
            : "No install has used this license, so you send the new key."
        }`}
      </Text>
      <HStack gap={2} justify="end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={change === undefined}
          loading={isSaving}
          onClick={() => change && onChange(change)}
        >
          {saveLabel(change)}
        </Button>
      </HStack>
    </VStack>
  );
}
