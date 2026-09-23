import { Box, Button, Text, VStack } from "@chakra-ui/react";
import type { UiJoinOfferProps } from "@langwatch/browser-host/declarations";
import { Dialog } from "@langwatch/design-system/dialog";
import type { ReactNode } from "react";

import { useOrganizationHost } from "../../../../model/organization-host.ts";
import { useJoinOffer } from "../../behavior/use-join-offer.ts";

/**
 * The post-login offer: "your colleagues are already here", or the wait after
 * asking. A dashboard names its organization to scope the pending request;
 * onboarding omits it so any request still blocks creating a second one.
 */
export function JoinYourTeamTakeover({
  dismissLabel = "Not now, keep working on my own",
  onDismissed,
  fallback = null,
  currentOrganizationId = null,
}: UiJoinOfferProps) {
  const host = useOrganizationHost();
  const { view, asking, dismissing, ask, dismiss, checkAgain } = useJoinOffer({
    currentOrganizationId,
  });

  if (view === null) return null;

  if (view.kind === "waiting") {
    return (
      <Takeover title="Waiting for an administrator" testId="join-team-waiting">
        <Text fontSize="14px" lineHeight="1.65" color="fg.muted" textAlign="center">
          {view.organizationName === null
            ? "Your request to join is with the administrators."
            : `Your request to join ${view.organizationName} is with their administrators.`}{" "}
          We will email you as soon as somebody answers, either way.
        </Text>
        <Button colorPalette="orange" width="full" minHeight="44px" onClick={checkAgain}>
          Check again
        </Button>
        <Button variant="outline" width="full" minHeight="44px" onClick={() => host.signOut()}>
          Sign out
        </Button>
      </Takeover>
    );
  }

  if (view.kind === "nothing") return <>{fallback}</>;

  return (
    <Takeover
      title="Your colleagues are already here"
      intro="Join them instead of building in a workspace of your own."
      testId="join-team-takeover"
    >
      {view.organizations.map((organization) => (
        <Button
          key={organization.organizationId}
          colorPalette="orange"
          width="full"
          minHeight="44px"
          loading={asking}
          onClick={() => ask(organization.organizationId)}
        >
          Ask to join {organization.name}
        </Button>
      ))}
      <Button
        variant="outline"
        width="full"
        minHeight="44px"
        loading={dismissing}
        onClick={() => dismiss(onDismissed)}
      >
        {dismissLabel}
      </Button>
      <Text fontSize="12.5px" color="fg.subtle" textAlign="center">
        We will not ask about this domain again.
      </Text>
    </Takeover>
  );
}

/**
 * A cover that a backdrop click cannot dismiss: "not now" is right there, and a
 * stray click is not an answer — treating it as one asks them again tomorrow.
 */
function Takeover({
  title,
  intro,
  testId,
  children,
}: {
  title: string;
  intro?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open
      size="cover"
      placement="center"
      closeOnInteractOutside={false}
      closeOnEscape={false}
      onOpenChange={() => void 0}
    >
      <Dialog.Content data-testid={testId} bg="bg" borderRadius={0}>
        <Dialog.Body display="flex" alignItems="center" justifyContent="center" padding={6}>
          <VStack width="full" maxWidth="420px" align="stretch" gap="18px">
            <Box>
              <Dialog.Title
                fontSize="22px"
                fontWeight={600}
                letterSpacing="-0.01em"
                textAlign="center"
              >
                {title}
              </Dialog.Title>
              {intro !== undefined && (
                <Text fontSize="14px" color="fg.muted" textAlign="center" paddingTop="6px">
                  {intro}
                </Text>
              )}
            </Box>
            {children}
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export default JoinYourTeamTakeover;
