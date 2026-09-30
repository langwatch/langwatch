import { Button, HStack } from "@chakra-ui/react";
import type { License } from "./types";
import { useLicenseCommands } from "./useLicenseCommands";

export function LicenseDrawerActions({
  license,
  onRevoke,
}: {
  license: License;
  onRevoke: (license: License) => void;
}) {
  const commands = useLicenseCommands();
  return (
    <HStack gap={3}>
      {license.instanceId ? (
        <Button
          size="sm"
          variant="outline"
          loading={commands.resetInstanceBinding.isPending}
          onClick={() =>
            commands.resetInstanceBinding.mutate({ id: license.id })
          }
        >
          Reset instance binding
        </Button>
      ) : null}
      {license.status === "active" || license.status === "expired" ? (
        <Button
          size="sm"
          variant="outline"
          colorPalette="red"
          onClick={() => onRevoke(license)}
        >
          Revoke
        </Button>
      ) : null}
    </HStack>
  );
}
