// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What LangWatch is, to somebody about to configure their identity provider
 * (D09). Shown BEFORE a single field is asked for, because that is the order
 * the work happens in: an administrator sets an application up over there,
 * and needs these values to do it. A form that only asked questions would
 * send them away to guess, and what they would guess is ours.
 */
import { Text, VStack } from "@chakra-ui/react";
import type { SsoConnectionType } from "@langwatch/identity-contract";

import {
  SERVICE_PROVIDER_PLACEHOLDER,
  serviceProviderRowsFor,
  type ServiceProviderAddresses,
} from "../../model/service-provider-rows.ts";
import { CopyValueRow } from "../elements/copy-value-row.tsx";
import { SettingsCard } from "../elements/settings-card.tsx";

export function ServiceProviderSection({
  protocol,
  addresses,
  connected,
}: {
  /** Which protocol's values to show; the other's are noise to this reader. */
  protocol: SsoConnectionType;
  addresses: ServiceProviderAddresses;
  /** Whether a connection exists yet, which is what fills the placeholder. */
  connected: boolean;
}) {
  const rows = serviceProviderRowsFor({ protocol, addresses });
  const one = rows.length === 1;

  return (
    <SettingsCard title="Set LangWatch up in your identity provider" testId="service-provider">
      <Text color="fg.muted" fontSize="sm" maxWidth="72ch">
        {one
          ? "Create an application there and give it this address. It is ours and it does not change."
          : "Create an application there and give it these values. They are ours and they do not change."}
        {!connected && (
          <>
            {" "}
            The part shown as <code>{SERVICE_PROVIDER_PLACEHOLDER}</code> is filled in once you
            register below, so come back for the finished {one ? "address" : "addresses"}.
          </>
        )}
      </Text>
      <VStack align="stretch" gap={2}>
        {rows.map((row) => (
          <CopyValueRow key={row.label} label={row.label} hint={row.hint} value={row.value} />
        ))}
      </VStack>
    </SettingsCard>
  );
}
