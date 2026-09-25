/**
 * The addresses an account can be reached and recovered at, and the ways to change
 * that set. Remove stands down before the click where the detach guard would refuse.
 * Spec: specs/identity/authentication-settings.feature
 */

import { Box, Button, HStack, Spinner, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

import { HandledErrorAlert } from "../../../../ui/elements/handled-error-alert.tsx";
import { useEmailIdentifiers } from "../../behavior/use-email-identifiers.ts";
import { AddAddressForm } from "../elements/add-address-form.tsx";
import { AddressConfirmationNotice } from "./address-confirmation-notice.tsx";
import { AddressRow } from "./address-row.tsx";

export function EmailIdentifiersSection({
  providerRows,
  trailingActions,
}: {
  /** The linked-account rows, one list with the addresses. */
  providerRows?: ReactNode;
  /** What shares the one action row with "Add email address". */
  trailingActions?: ReactNode;
}) {
  const identifiers = useEmailIdentifiers();
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const closeDraft = () => {
    setIsAdding(false);
    setDraft("");
  };
  const submitDraft = async () => {
    if (await identifiers.add(draft.trim())) closeDraft();
  };

  return (
    <VStack width="full" align="stretch" gap={4} data-testid="email-identifiers-section">
      <AddressConfirmationNotice onConfirmed={identifiers.refresh} />

      {identifiers.isPending ? <Spinner size="sm" /> : null}

      <HandledErrorAlert
        error={identifiers.error}
        fallbackTitle="Couldn't load the addresses on this account"
      />

      <VStack width="full" align="stretch" gap={2}>
        <AddressList identifiers={identifiers} />
        {providerRows}
      </VStack>

      <HStack
        width="full"
        gap={4}
        flexWrap="wrap"
        align="center"
        justify="space-between"
        data-testid="identifier-action-row"
      >
        <Button
          size="sm"
          variant="outline"
          aria-expanded={isAdding}
          onClick={isAdding ? closeDraft : () => setIsAdding(true)}
          data-testid="add-address"
        >
          <Plus size={14} />
          Add email address
        </Button>
        {trailingActions ? (
          <HStack gap={4} align="center" flexWrap="wrap">
            <Box
              display={{ base: "none", md: "block" }}
              width="1px"
              height="8"
              backgroundColor="border.emphasized"
              flexShrink={0}
              aria-hidden="true"
            />
            {trailingActions}
          </HStack>
        ) : null}
      </HStack>

      {isAdding ? (
        <AddAddressForm
          address={draft}
          onAddressChange={setDraft}
          onSubmit={() => void submitDraft()}
          onCancel={closeDraft}
          isSending={identifiers.isAdding}
        />
      ) : null}
    </VStack>
  );
}

function AddressList({ identifiers }: { identifiers: ReturnType<typeof useEmailIdentifiers> }) {
  if (identifiers.emailRows.length > 0) {
    return identifiers.emailRows.map((row) => (
      <AddressRow
        key={row.identifierId}
        row={{ ...row, value: row.value ?? "" }}
        linkJustSent={identifiers.sentTo !== void 0 && identifiers.sentTo === row.value}
        lastUsedAt={identifiers.lastUsedByIdentifier[row.identifierId]}
        isSending={identifiers.resendingId === row.identifierId}
        isRemoving={identifiers.isRemoving}
        onResend={() => identifiers.resend(row)}
        onRemove={() => void identifiers.remove(row)}
      />
    ));
  }
  if (!identifiers.ownAddress || identifiers.isPending) return null;
  // Before this account has identifiers, its own address is still the primary one.
  return (
    <AddressRow
      row={{
        value: identifiers.ownAddress,
        isPrimary: true,
        confirmed: void 0,
        resendable: false,
        removable: false,
        refusalCode: null,
        demotesFirst: false,
      }}
      linkJustSent={false}
      lastUsedAt={void 0}
      isSending={false}
      isRemoving={false}
      onResend={() => Promise.resolve(void 0)}
      onRemove={() => void 0}
      hideRemove
    />
  );
}
