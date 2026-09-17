import { Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { api } from "../../../utils/api";

/** Mount after a command is accepted; remove when its setup projection settles. */
export function PendingSetupChange({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  api.ssoSetup.getSetup.useQuery(
    { organizationId },
    { refetchInterval: 1_000 },
  );

  return (
    <Text role="status" color="fg.muted" fontSize="sm">
      {children}
    </Text>
  );
}
