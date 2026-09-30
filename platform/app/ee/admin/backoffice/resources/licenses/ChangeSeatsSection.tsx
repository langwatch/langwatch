import { Button, Field, HStack, Input, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { Section } from "./DrawerSection";
import { SignedLicenseOnce } from "./SignedLicenseOnce";
import type { License } from "./types";

type ChangeSeatsResult = {
  licenseKey: string;
  previousMaxMembers: number;
  license: { maxMembers: number };
  billing: "invoiced" | "nothing_to_invoice" | "not_onboarded";
};

/** What the operator reads once the seats changed. */
export function seatChangeSummary(result: ChangeSeatsResult): string {
  const moved =
    result.license.maxMembers > result.previousMaxMembers
      ? `raised from ${result.previousMaxMembers} to ${result.license.maxMembers}`
      : `lowered from ${result.previousMaxMembers} to ${result.license.maxMembers}`;
  const billing =
    result.billing === "invoiced"
      ? "The added seats were invoiced, prorated to the end of the term."
      : result.billing === "not_onboarded"
        ? "No billing account yet, so finance invoices the added seats by hand."
        : result.license.maxMembers > result.previousMaxMembers
          ? "Nothing was invoiced: the term has no days left to charge for."
          : "Seats that went down are not credited.";
  return `Seats ${moved}. The install picks the new license up on its next sync or when an admin presses refresh. ${billing}`;
}

export function ChangeSeatsSection({ license }: { license: License }) {
  const [seats, setSeats] = useState("");
  const [result, setResult] = useState<ChangeSeatsResult | null>(null);
  const utils = api.useContext();
  const changeSeats = api.licenseRegistry.changeSeats.useMutation({
    onSuccess: async (changed) => {
      setResult(changed);
      await utils.licenseRegistry.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "The seats were not changed" }),
  });

  useEffect(() => {
    setSeats(license.maxMembers.toString());
  }, [license]);

  // Only another license clears what is shown: the signed license is not
  // stored anywhere, and refetching this one must not take it off the screen.
  const licenseId = license.id;
  useEffect(() => {
    setResult(null);
  }, [licenseId]);

  const requested = Number(seats);
  const unchanged =
    seats.trim() === "" ||
    !Number.isInteger(requested) ||
    requested < 1 ||
    requested === license.maxMembers;

  return (
    <Section title="Change seats">
      <Text fontSize="sm" color="fg.muted">
        Reissues the license for the same term with a new seat count. Seats that
        go up are invoiced prorated to the end of the term; seats that go down
        are not credited.
      </Text>
      <HStack align="end" gap={3}>
        <Field.Root width="40">
          <Field.Label>Seats</Field.Label>
          <Input
            type="number"
            min={1}
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
            data-testid="change-seats-input"
          />
        </Field.Root>
        <Button
          size="sm"
          disabled={unchanged}
          loading={changeSeats.isPending}
          onClick={() =>
            changeSeats.mutate({ id: license.id, maxMembers: requested })
          }
        >
          Change seats
        </Button>
      </HStack>
      {result ? (
        <>
          <Text fontSize="sm" data-testid="change-seats-result">
            {seatChangeSummary(result)}
          </Text>
          <SignedLicenseOnce licenseKey={result.licenseKey} />
        </>
      ) : null}
    </Section>
  );
}
