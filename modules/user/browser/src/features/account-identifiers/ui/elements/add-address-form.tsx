import { Button, HStack, Input } from "@chakra-ui/react";

/** The address field and its two answers, on a row under the offers. Enter sends, Escape closes. */
export function AddAddressForm({
  address,
  onAddressChange,
  onSubmit,
  onCancel,
  isSending,
}: {
  address: string;
  onAddressChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSending: boolean;
}) {
  return (
    <HStack width="full" gap={2} justify="flex-end" align="center">
      <Input
        size="sm"
        type="email"
        aria-label="New email address"
        placeholder="you@company.com"
        maxWidth="320px"
        value={address}
        onChange={(event) => onAddressChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && address.trim()) {
            event.preventDefault();
            onSubmit();
          }
          if (event.key === "Escape") onCancel();
        }}
        data-testid="new-address"
      />
      <Button
        size="sm"
        colorPalette="orange"
        loading={isSending}
        disabled={!address.trim()}
        onClick={onSubmit}
        data-testid="confirm-add-address"
      >
        Send confirmation
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </HStack>
  );
}
