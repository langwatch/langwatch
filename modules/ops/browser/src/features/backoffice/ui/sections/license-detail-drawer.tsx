import { Button, Field, HStack, Input, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { Suspense, useEffect, useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useLicenseBillingSections } from "../../behavior/use-license-billing-sections.ts";
import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import {
  termsFormFrom,
  termsPayload,
  type License,
  type TermsForm,
} from "../../model/license-terms.ts";
import { LicenseTermsFields } from "../blocks/license-terms-fields.tsx";
import {
  dateInputToISO,
  EmptyCell,
  formatDate,
  formatDateTime,
} from "../elements/backoffice-cells.tsx";
import { Detail, Section } from "../elements/drawer-sections.tsx";
import { LicenseStatusBadge } from "../elements/license-status-badge.tsx";
import { SignedLicenseOnce } from "../elements/signed-license-once.tsx";

export function LicenseDetailDrawer({
  licenseId,
  onClose,
  onRevoke,
}: {
  licenseId: string | null;
  onClose: () => void;
  onRevoke: (license: License) => void;
}) {
  const query = api.licenseRegistry.getById.useQuery(
    { id: licenseId ?? "" },
    { enabled: licenseId !== null, retry: false },
  );
  const license = query.data;

  return (
    <Drawer.Root
      open={licenseId !== null}
      onOpenChange={({ open }) => !open && onClose()}
      size="lg"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{license ? license.organizationName : "License"}</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          <DrawerContent isLoading={query.isLoading} license={license} onRevoke={onRevoke} />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function DrawerContent({
  isLoading,
  license,
  onRevoke,
}: {
  isLoading: boolean;
  license: License | undefined;
  onRevoke: (license: License) => void;
}) {
  if (isLoading) return <Text color="fg.muted">Loading…</Text>;
  if (!license) return <Text color="fg.error">Couldn't load this license.</Text>;
  return <DrawerBody license={license} onRevoke={onRevoke} />;
}

function DrawerBody({
  license,
  onRevoke,
}: {
  license: License;
  onRevoke: (license: License) => void;
}) {
  const [linkOrganizationId, setLinkOrganizationId] = useState("");

  return (
    <VStack align="start" gap={6} width="full">
      <LicenseDetails license={license} />
      {license.organizationId ? null : (
        <LinkOrganizationSection
          license={license}
          organizationId={linkOrganizationId}
          onOrganizationIdChange={setLinkOrganizationId}
        />
      )}
      <TermsSection license={license} />
      {license.organizationId ? (
        <LicenseBillingSections license={license} organizationId={license.organizationId} />
      ) : null}
      {license.status === "active" ? <ChangeSeatsSection license={license} /> : null}
      {license.status === "active" || license.status === "expired" ? (
        <ReissueSection license={license} />
      ) : null}
      <DrawerActions license={license} onRevoke={onRevoke} />
    </VStack>
  );
}

/** Invoice billing for the customer a license is linked to, where a module declared it. */
function LicenseBillingSections({
  license,
  organizationId,
}: {
  license: License;
  organizationId: string;
}) {
  const sections = useLicenseBillingSections();
  return sections.map(({ key, Section }) => (
    <Suspense key={key} fallback={null}>
      <Section
        organizationId={organizationId}
        organizationName={license.organizationName}
        email={license.email}
        issuedAt={license.issuedAt}
        expiresAt={license.expiresAt}
        maxMembers={license.maxMembers}
        seatRateCents={license.seatRateCents}
        seatCurrency={license.seatCurrency}
        commitUsdCents={license.commitUsdCents}
      />
    </Suspense>
  ));
}

function LicenseDetails({ license }: { license: License }) {
  return (
    <SimpleGrid columns={2} gap={3} width="full" fontSize="sm">
      <Detail label="Status">
        <LicenseStatusBadge status={license.status} />
      </Detail>
      <Detail label="License id">{license.licenseId}</Detail>
      <Detail label="Plan">{license.planType}</Detail>
      <Detail label="Seats">
        {license.maxMembers} full, {license.maxMembersLite} lite
      </Detail>
      <Detail label="Issued">{formatDate(license.issuedAt)}</Detail>
      <Detail label="Term ends">{formatDate(license.expiresAt)}</Detail>
      <Detail label="Source">{license.source}</Detail>
      <Detail label="Email">{license.email}</Detail>
      <Detail label="Instance">
        {license.instanceId
          ? `${license.instanceId} since ${formatDateTime(license.instanceBoundAt)}`
          : "not bound yet"}
      </Detail>
      <Detail label="Replaces">{license.replacesId ?? <EmptyCell>none</EmptyCell>}</Detail>
      <Detail label="Last sync">
        {license.lastSyncAt ? (
          `${formatDateTime(license.lastSyncAt)} from ${license.lastSyncVersion ?? "an unnamed version"}`
        ) : (
          <EmptyCell>never synced</EmptyCell>
        )}
      </Detail>
      <Detail label="Seats reported">
        {license.lastSyncAt ? (
          `${license.reportedMembers ?? 0} full, ${license.reportedMembersLite ?? 0} lite`
        ) : (
          <EmptyCell>none</EmptyCell>
        )}
      </Detail>
      {license.revokedAt ? (
        <Detail label="Revoked">
          {formatDateTime(license.revokedAt)}: {license.revokedReason}
        </Detail>
      ) : null}
      {license.hasPendingDelivery ? (
        <Detail label="Delivery">Reissued license waiting for the install to sync</Detail>
      ) : null}
    </SimpleGrid>
  );
}

function LinkOrganizationSection({
  license,
  organizationId,
  onOrganizationIdChange,
}: {
  license: License;
  organizationId: string;
  onOrganizationIdChange: (value: string) => void;
}) {
  const commands = useLicenseCommands();
  return (
    <Section title="Link to a customer organization">
      <Text fontSize="sm" color="fg.muted">
        Until it is linked, this license resolves to no customer and cannot use hosted services.
      </Text>
      <HStack width="full">
        <Input
          value={organizationId}
          onChange={(event) => onOrganizationIdChange(event.target.value)}
          placeholder="Organization id"
        />
        <Button
          size="sm"
          disabled={organizationId.trim() === ""}
          loading={commands.linkToOrganization.isPending}
          onClick={() =>
            commands.linkToOrganization.mutate({
              id: license.id,
              organizationId: organizationId.trim(),
            })
          }
        >
          Link
        </Button>
      </HStack>
    </Section>
  );
}

function TermsSection({ license }: { license: License }) {
  const commands = useLicenseCommands();
  const [terms, setTerms] = useState<TermsForm>(() => termsFormFrom(license));

  useEffect(() => {
    setTerms(termsFormFrom(license));
  }, [license]);

  return (
    <Section title="Entitlements and terms">
      <LicenseTermsFields form={terms} onChange={setTerms} />
      <Button
        size="sm"
        loading={commands.updateTerms.isPending}
        onClick={() => commands.updateTerms.mutate({ id: license.id, ...termsPayload(terms) })}
      >
        Save terms
      </Button>
    </Section>
  );
}

function ChangeSeatsSection({ license }: { license: License }) {
  const commands = useLicenseCommands();
  const [seats, setSeats] = useState(() => license.maxMembers.toString());
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  useEffect(() => {
    setSeats(license.maxMembers.toString());
  }, [license]);

  // Only another license clears what is shown: the signed license is not
  // stored anywhere, and refetching this one must not take it off the screen.
  const licenseId = license.id;
  useEffect(() => {
    setIssuedKey(null);
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
        Reissues the license for the same term with a new seat count. Seats that go up are invoiced
        prorated to the end of the term; seats that go down are not credited.
      </Text>
      <HStack align="end" gap={3}>
        <Field.Root width="40">
          <Field.Label>Seats</Field.Label>
          <Input
            type="number"
            min={1}
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          />
        </Field.Root>
        <Button
          size="sm"
          disabled={unchanged}
          loading={commands.changeSeats.isPending}
          onClick={() =>
            commands.changeSeats.mutate(
              { id: license.id, maxMembers: requested },
              { onSuccess: (result) => setIssuedKey(result.licenseKey) },
            )
          }
        >
          Change seats
        </Button>
      </HStack>
      {issuedKey ? <SignedLicenseOnce licenseKey={issuedKey} /> : null}
    </Section>
  );
}

function ReissueSection({ license }: { license: License }) {
  const commands = useLicenseCommands();
  const [seats, setSeats] = useState(() => license.maxMembers.toString());
  const [expires, setExpires] = useState("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  useEffect(() => {
    setSeats(license.maxMembers.toString());
  }, [license]);

  // Only another license clears the key shown. Reissuing refetches this one,
  // and the license is not stored anywhere, so a reset on every refetch would
  // take it off the screen before the operator could copy it.
  const licenseId = license.id;
  useEffect(() => {
    setExpires("");
    setIssuedKey(null);
  }, [licenseId]);

  return (
    <Section title="Reissue">
      <Text fontSize="sm" color="fg.muted">
        Signs a replacement for a new term, which is how a license is renewed. The current license
        stays valid until the install picks the new one up over sync. Seats mid-term are changed
        above.
      </Text>
      <SimpleGrid columns={2} gap={3} width="full">
        <Field.Root>
          <Field.Label>Seats</Field.Label>
          <Input
            type="number"
            min={1}
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>New term end</Field.Label>
          <Input type="date" value={expires} onChange={(event) => setExpires(event.target.value)} />
        </Field.Root>
      </SimpleGrid>
      <Button
        size="sm"
        disabled={expires === "" || seats === ""}
        loading={commands.reissue.isPending}
        onClick={() => {
          const iso = dateInputToISO(expires);
          if (!iso) return;
          commands.reissue.mutate(
            { id: license.id, maxMembers: Number(seats), expiresAt: iso },
            { onSuccess: (result) => setIssuedKey(result.licenseKey) },
          );
        }}
      >
        Reissue license
      </Button>
      {issuedKey ? <SignedLicenseOnce licenseKey={issuedKey} /> : null}
    </Section>
  );
}

function DrawerActions({
  license,
  onRevoke,
}: {
  license: License;
  onRevoke: (license: License) => void;
}) {
  const commands = useLicenseCommands();
  return (
    <HStack gap={3}>
      {license.instanceId ? (
        <Button
          size="sm"
          variant="outline"
          loading={commands.resetInstanceBinding.isPending}
          onClick={() => commands.resetInstanceBinding.mutate({ id: license.id })}
        >
          Reset instance binding
        </Button>
      ) : null}
      {license.status === "active" || license.status === "expired" ? (
        <Button size="sm" variant="outline" colorPalette="red" onClick={() => onRevoke(license)}>
          Revoke
        </Button>
      ) : null}
    </HStack>
  );
}
