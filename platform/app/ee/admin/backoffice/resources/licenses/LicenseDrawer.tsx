import { Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import { api } from "~/utils/api";
import { BillingSection } from "./BillingSection";
import { LicenseDetails } from "./LicenseDetails";
import { LicenseDrawerActions } from "./LicenseDrawerActions";
import { LinkOrganizationSection } from "./LinkOrganizationSection";
import { ReissueSection } from "./ReissueSection";
import { TermsSection } from "./TermsSection";
import type { License } from "./types";

export function LicenseDrawer({
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
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="lg"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {license ? license.organizationName : "License"}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {license ? (
            <LicenseDrawerBody license={license} onRevoke={onRevoke} />
          ) : (
            <Text color="fg.muted">Loading...</Text>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function LicenseDrawerBody({
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
      <BillingSection license={license} />
      {license.status === "active" || license.status === "expired" ? (
        <ReissueSection license={license} />
      ) : null}
      <LicenseDrawerActions license={license} onRevoke={onRevoke} />
    </VStack>
  );
}
