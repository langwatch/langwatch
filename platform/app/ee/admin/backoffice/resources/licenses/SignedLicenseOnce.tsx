import { Text, Textarea, VStack } from "@chakra-ui/react";

/** One issued or reissued license, shown once. */
export function SignedLicenseOnce({ licenseKey }: { licenseKey: string }) {
  return (
    <VStack align="start" gap={2} width="full">
      <Text fontWeight="medium">Signed license</Text>
      <Text fontSize="sm" color="fg.muted">
        Copy it now and hand it to the customer. It is not stored and cannot be
        shown again.
      </Text>
      <Textarea
        readOnly
        rows={6}
        value={licenseKey}
        fontFamily="mono"
        fontSize="xs"
        onFocus={(event) => event.target.select()}
      />
    </VStack>
  );
}
