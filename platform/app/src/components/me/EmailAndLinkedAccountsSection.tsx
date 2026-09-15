import { AtSign } from "lucide-react";

import { SettingsSection } from "~/components/settings/SettingsSection";
import { EmailIdentifiersSection } from "~/features/account-identifiers";
import {
  ConnectProviderButtons,
  LinkedAccountRows,
  useConnectableProviders,
} from "./LinkedAccountsSection";

/**
 * The addresses this account is known by and the identity providers that vouch
 * for it, under one heading.
 *
 * One band because the identity model already holds them as one species: an
 * email identifier and a provider account are both `Identifier` rows, and the
 * detach guard reasons across the whole set at once — it is what makes
 * "removing this would leave you no way back in" answerable at all. Two
 * sections would have said they are two subjects, and then the same refusal
 * would have appeared in both for reasons neither could explain on its own.
 *
 * ONE list and ONE action row. No sub-headings: a label over the addresses and
 * another over the providers split a list whose rows already say what they are
 * — an address looks like an address, and a provider row carries its mark —
 * and it pushed "Add an email address" and "Connect Google" onto two separate
 * rows, which made one offer look like two.
 *
 * The addresses come first. They are the way back when everything else has
 * gone, and this is the door the guard's own remediation copy points at.
 */
export function EmailAndLinkedAccountsSection() {
  const connectable = useConnectableProviders();

  return (
    <SettingsSection
      anchorId="email-and-linked-accounts"
      icon={<AtSign size={18} />}
      title="Linked Accounts"
      description="The addresses this account is known by, and the identity providers that vouch for it."
      testId="email-and-linked-accounts-settings-section"
    >
      <EmailIdentifiersSection
        providerRows={<LinkedAccountRows />}
        trailingActions={<ConnectProviderButtons providers={connectable} />}
      />
    </SettingsSection>
  );
}
