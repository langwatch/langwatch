import { Button, Field, Input, SimpleGrid, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { dateInputToISO } from "../../BackofficeTable";
import { Section } from "./DrawerSection";
import { SignedLicenseOnce } from "./SignedLicenseOnce";
import type { License } from "./types";

export function ReissueSection({ license }: { license: License }) {
  const [seats, setSeats] = useState("");
  const [expires, setExpires] = useState("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const utils = api.useContext();
  const reissue = api.licenseRegistry.reissue.useMutation({
    onSuccess: async (result) => {
      setIssuedKey(result.licenseKey);
      await utils.licenseRegistry.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "The license was not reissued" }),
  });

  useEffect(() => {
    setSeats(license.maxMembers.toString());
    setExpires("");
    setIssuedKey(null);
  }, [license]);

  return (
    <Section title="Reissue">
      <Text fontSize="sm" color="fg.muted">
        Signs a replacement with new seats or a new term. The current license
        stays valid until the install picks the new one up over sync.
      </Text>
      <ReissueFields
        seats={seats}
        expires={expires}
        onSeatsChange={setSeats}
        onExpiresChange={setExpires}
      />
      <Button
        size="sm"
        disabled={expires === "" || seats === ""}
        loading={reissue.isPending}
        onClick={() => {
          const iso = dateInputToISO(expires);
          if (!iso) return;
          reissue.mutate({
            id: license.id,
            maxMembers: Number(seats),
            expiresAt: new Date(iso),
          });
        }}
      >
        Reissue license
      </Button>
      {issuedKey ? <SignedLicenseOnce licenseKey={issuedKey} /> : null}
    </Section>
  );
}

function ReissueFields({
  seats,
  expires,
  onSeatsChange,
  onExpiresChange,
}: {
  seats: string;
  expires: string;
  onSeatsChange: (value: string) => void;
  onExpiresChange: (value: string) => void;
}) {
  return (
    <SimpleGrid columns={2} gap={3} width="full">
      <Field.Root>
        <Field.Label>Seats</Field.Label>
        <Input
          type="number"
          min={1}
          value={seats}
          onChange={(event) => onSeatsChange(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>New term end</Field.Label>
        <Input
          type="date"
          value={expires}
          onChange={(event) => onExpiresChange(event.target.value)}
        />
      </Field.Root>
    </SimpleGrid>
  );
}
