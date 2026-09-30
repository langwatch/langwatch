import { Text } from "@chakra-ui/react";
import type { SelfServeSetupView } from "@ee/sso/sso-self-serve.types";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { api } from "~/utils/api";

/** Mount after a command is accepted; remove when its setup projection settles. */
export function PendingSetupChange({
  organizationId,
  children,
  isSettled,
  onSettled,
}: {
  organizationId: string;
  children: ReactNode;
  isSettled: (setup: SelfServeSetupView) => boolean;
  onSettled: () => void;
}) {
  const setup = api.ssoSetup.getSetup.useQuery(
    { organizationId },
    { refetchInterval: 1_000 },
  );
  useEffect(() => {
    if (setup.data && isSettled(setup.data)) onSettled();
  }, [isSettled, onSettled, setup.data]);

  return (
    <Text role="status" color="fg.muted" fontSize="sm">
      {children}
    </Text>
  );
}
