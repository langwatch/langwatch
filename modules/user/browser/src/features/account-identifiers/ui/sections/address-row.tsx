import { Button, HStack, Spacer, VStack } from "@chakra-ui/react";

import { useResendBackoff } from "../../behavior/use-resend-backoff.ts";
import { AddressBadges } from "../elements/address-badges.tsx";
import { AddressRowNote } from "../elements/address-row-note.tsx";
import { RemoveAddressButton } from "../elements/remove-address-button.tsx";

export type AddressRowView = {
  value: string;
  isPrimary: boolean;
  /** Undefined where nothing has said whether the address is confirmed. */
  confirmed: boolean | undefined;
  resendable: boolean;
  removable: boolean;
  refusalCode: string | null;
  demotesFirst: boolean;
};

/**
 * One address and what can be done to it. The resend wait is per row: two
 * unconfirmed addresses are two separate conversations.
 */
export function AddressRow({
  row,
  linkJustSent,
  lastUsedAt,
  isSending,
  isRemoving,
  onResend,
  onRemove,
  hideRemove = false,
}: {
  row: AddressRowView;
  linkJustSent: boolean;
  lastUsedAt: string | undefined;
  isSending: boolean;
  isRemoving: boolean;
  /** Resolves the server's wait in seconds when it refused for rate limiting. */
  onResend: () => Promise<number | undefined>;
  onRemove: () => void;
  hideRemove?: boolean;
}) {
  const backoff = useResendBackoff();

  return (
    <HStack
      width="full"
      gap={3}
      paddingY={2}
      borderBottomWidth="1px"
      borderColor="border.muted"
      data-testid="email-identifier-row"
    >
      <VStack align="start" gap={0} minWidth={0}>
        <AddressBadges value={row.value} isPrimary={row.isPrimary} confirmed={row.confirmed} />
        <AddressRowNote
          value={row.value}
          linkJustSent={linkJustSent}
          demotesFirst={row.demotesFirst && row.removable}
          lastUsedAt={lastUsedAt}
        />
      </VStack>
      <Spacer />
      {row.resendable ? (
        <Button
          size="xs"
          variant="outline"
          loading={isSending}
          disabled={backoff.isWaiting}
          onClick={() => {
            backoff.recordAttempt();
            void onResend().then((retryAfterSeconds) => {
              if (retryAfterSeconds !== void 0) backoff.holdFor(retryAfterSeconds);
            });
          }}
          data-testid="resend-address-link"
        >
          {backoff.secondsToWait === void 0
            ? "Send the link again"
            : `Send it again in ${backoff.secondsToWait}s`}
        </Button>
      ) : null}
      {hideRemove ? null : (
        <RemoveAddressButton
          refusalCode={row.refusalCode}
          removable={row.removable}
          isPending={isRemoving}
          onRemove={onRemove}
        />
      )}
    </HStack>
  );
}
