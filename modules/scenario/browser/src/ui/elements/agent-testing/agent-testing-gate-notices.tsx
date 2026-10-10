import { Heading, Text, VStack } from "@langwatch/design-system/primitives";
import { RestrictedAccess } from "@langwatch/design-system/restricted-access";

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
  return <RestrictedAccess permission={permission} area="Agent Testing" />;
}
