import { Button, HStack, Input, Text } from "@chakra-ui/react";
import { Section } from "./DrawerSection";
import type { License } from "./types";
import { useLicenseCommands } from "./useLicenseCommands";

export function LinkOrganizationSection({
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
        Until it is linked, this license resolves to no customer and cannot use
        hosted services.
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
