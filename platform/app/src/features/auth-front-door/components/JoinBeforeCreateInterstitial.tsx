import { Button, Text, VStack } from "@chakra-ui/react";
import { useEffect } from "react";
import {
  type JoinableOrganization,
  resolveJoinBeforeCreate,
} from "../logic/joinBeforeCreate";

/**
 * Join before create (ADR-117 §6): the step between confirming an address and
 * creating a workspace, where somebody whose colleagues are already here is
 * offered their team instead of a second organization nobody meant to make.
 *
 * D12 fills in which organizations will take an address, and the words that go
 * with them. Until then the decision is always "create a workspace", this
 * renders nothing at all, and sign-up carries straight on — the seam is here
 * so that filling it changes nobody who calls it.
 */
export function JoinBeforeCreateInterstitial({
  verifiedEmail,
  onJoinOrganization,
  onCreateWorkspace,
}: {
  verifiedEmail: string;
  onJoinOrganization: (organization: JoinableOrganization) => void;
  onCreateWorkspace: () => void;
}) {
  const decision = resolveJoinBeforeCreate({ verifiedEmail });
  const nothingToOffer = decision.outcome === "create_workspace";

  useEffect(() => {
    if (nothingToOffer) onCreateWorkspace();
  }, [nothingToOffer, onCreateWorkspace]);

  if (decision.outcome === "create_workspace") return null;

  return (
    <VStack
      width="full"
      align="stretch"
      gap={4}
      data-testid="join-before-create"
    >
      <Text>
        Your colleagues are already on LangWatch. Join them instead of starting
        a separate workspace.
      </Text>
      {decision.organizations.map((organization) => (
        <Button
          key={organization.id}
          colorPalette="orange"
          width="full"
          onClick={() => onJoinOrganization(organization)}
        >
          Join {organization.name}
        </Button>
      ))}
      <Button variant="outline" width="full" onClick={onCreateWorkspace}>
        Create a new organization
      </Button>
    </VStack>
  );
}
