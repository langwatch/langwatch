import { Heading, Text, VStack } from "@langwatch/design-system/primitives";

/** What an address that does not exist for this reader shows. */
export function PageAbsentNotice() {
  return (
    <VStack paddingY={16} gap={2}>
      <Heading size="md">Page not found</Heading>
      <Text color="fg.muted">Sorry, this page does not exist.</Text>
    </VStack>
  );
}

/** What a reader without the grant a page needs is shown. */
export function PermissionRequiredNotice({ permission }: { permission: string }) {
  return (
    <VStack paddingY={16} gap={2}>
      <Heading size="md">Access Restricted</Heading>
      <Text color="fg.muted">You need the {permission} permission to open this page.</Text>
    </VStack>
  );
}
