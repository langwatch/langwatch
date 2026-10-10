import { Button, Text, VStack } from "@langwatch/design-system/primitives";
import type { JoinInsteadProps } from "@langwatch/organization-client";
import { useState } from "react";

import { useJoinInstead } from "../../behavior/use-join-instead.ts";
import type { JoinInsteadOrganization } from "../../model/join-instead.ts";

/**
 * Below the organization form, for somebody who already declined the offer:
 * one quiet action back to the team instead of a second takeover asking again.
 */
export function JoinInsteadAction({ origin = "web" }: JoinInsteadProps) {
  const { view, joining, join } = useJoinInstead({ origin });
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  if (view.kind === "hidden") return null;

  const joinOne = (organization: JoinInsteadOrganization) => {
    setPicked(organization.organizationId);
    join(organization);
  };

  if (view.kind === "one") {
    const { organization } = view;
    return (
      <VStack data-testid="join-instead-action" gap={0}>
        <Button
          variant="ghost"
          size="sm"
          color="fg.muted"
          loading={joining}
          onClick={() => joinOne(organization)}
        >
          Join {organization.name} instead
        </Button>
      </VStack>
    );
  }

  return (
    <VStack data-testid="join-instead-action" gap={2} align="stretch">
      <Button
        variant="ghost"
        size="sm"
        color="fg.muted"
        alignSelf="center"
        aria-expanded={choosing}
        onClick={() => setChoosing((open) => !open)}
      >
        Join an existing organization
      </Button>
      {choosing && (
        <VStack gap={2} align="stretch" data-testid="join-instead-chooser">
          <Text fontSize="12.5px" color="fg.subtle" textAlign="center">
            Your colleagues are in these organizations. Pick the one to join.
          </Text>
          {view.organizations.map((organization) => (
            <Button
              key={organization.organizationId}
              variant="outline"
              size="sm"
              loading={joining && picked === organization.organizationId}
              disabled={joining}
              onClick={() => joinOne(organization)}
            >
              {organization.admits === "auto" ? "Join" : "Ask to join"} {organization.name}
            </Button>
          ))}
        </VStack>
      )}
    </VStack>
  );
}

export default JoinInsteadAction;
