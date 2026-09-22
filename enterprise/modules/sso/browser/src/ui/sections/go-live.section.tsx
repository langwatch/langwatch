// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The last step, as a checklist rather than a verdict: every precondition is
 * shown, met or not, with the thing that would meet it named beside it. The
 * aggregate refuses one at a time; a person planning an afternoon has to see
 * what the afternoon contains. There is no suspend here — the lever for a
 * connection that is hurting people is an operator's, not this page's.
 */
import { Badge, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";

import { setupProgressFor } from "../../model/setup-progress.ts";
import { InlineRefusal } from "../elements/refusals.tsx";

export function GoLiveSection({
  canManage,
  activated,
  domainProved,
  testSignInDone,
  breakGlassInPlace,
  arrivalsDecided,
  activating = false,
  settling = false,
  refusal,
  onActivate,
  onSetUpProvisioning,
}: {
  canManage: boolean;
  activated: boolean;
  domainProved: boolean;
  testSignInDone: boolean;
  breakGlassInPlace: boolean;
  /** Whether anybody has said who the connection admits (ADR-117 §3). */
  arrivalsDecided: boolean;
  activating?: boolean;
  /** Set between the activation being accepted and the read catching up. */
  settling?: boolean;
  /** What the last attempt was refused with, said beside the control that
   *  caused it rather than in a toast that leaves. */
  refusal?: unknown;
  onActivate: () => void;
  /** Where the errand carries on once it is on, as the screen routes it. */
  onSetUpProvisioning?: () => void;
}) {
  const progress = setupProgressFor({
    domainProved,
    testSignInDone,
    breakGlassInPlace,
    arrivalsDecided,
    activated,
  });

  return (
    <VStack align="stretch" gap={3} width="full" data-testid="connection-go-live">
      {activated ? (
        <LiveAndWhatIsNext onSetUpProvisioning={onSetUpProvisioning} />
      ) : (
        <VStack align="stretch" gap={3}>
          <Text color="fg.muted" fontSize="sm">
            Until it is on, nobody&apos;s sign-in goes anywhere near your identity provider.
          </Text>
          <InlineRefusal error={refusal} what="Turning it on" />
          <Precondition
            met={domainProved}
            metText="A domain of yours is proved"
            unmetText="No domain of yours is proved yet"
            next="Claim a domain above and publish the record we give you."
          />
          <Precondition
            met={testSignInDone}
            metText="Somebody has signed in through the connection"
            unmetText="Nobody has signed in through the connection yet"
            next="Use the test sign-in above."
          />
          <Precondition
            met={breakGlassInPlace}
            metText="Somebody can still get in without the identity provider"
            unmetText="Nobody can get in without the identity provider"
            next="Name somebody who can still get in, above."
          />
          <Precondition
            met={arrivalsDecided}
            metText="You have said who this connection lets in"
            unmetText="Nobody has said who this connection lets in"
            next="Answer who gets in, above."
          />
          {canManage &&
            // The decision this whole page leads to, at the weight of one:
            // green like every settled state above it, because this is the
            // step that settles the connection itself.
            (progress.goLiveBlockedBecause === null ? (
              <Button
                alignSelf="start"
                size="lg"
                colorPalette="green"
                loading={activating}
                loadingText="Turning on"
                disabled={settling}
                data-testid="connection-go-live-activate"
                onClick={onActivate}
              >
                Go live
              </Button>
            ) : (
              <Text fontSize="sm" color="fg.muted">
                {progress.goLiveBlockedBecause}
              </Text>
            ))}
          {settling && (
            <Text as="output" fontSize="xs" color="fg.muted">
              Activation accepted. Updating your connection status…
            </Text>
          )}
        </VStack>
      )}
    </VStack>
  );
}

/**
 * The errand is not finished when the connection goes on. Signing in and
 * being provisioned are one continuous piece of work, so the step that ends
 * this journey says what the next one is rather than leaving it to be found.
 */
function LiveAndWhatIsNext({ onSetUpProvisioning }: { onSetUpProvisioning?: () => void }) {
  return (
    <VStack align="start" gap={3}>
      <Text color="fg.muted" fontSize="sm">
        This connection is on. The chip beside its name says whether sign-in is being decided by it
        yet.
      </Text>
      <Text color="fg.muted" fontSize="sm">
        Next, let your identity provider create and remove accounts here as people join and leave.
        Set the provisioning token, or paste the one your provider already has, and point it at us.
      </Text>
      {onSetUpProvisioning && (
        <Button size="sm" variant="outline" onClick={onSetUpProvisioning}>
          Set up provisioning
          <ArrowRight size={14} />
        </Button>
      )}
    </VStack>
  );
}

/** One precondition: whether it is met, and what would meet it if not. */
function Precondition({
  met,
  metText,
  unmetText,
  next,
}: {
  met: boolean;
  metText: string;
  unmetText: string;
  next: string;
}) {
  return (
    <HStack align="start" gap={3} data-testid="connection-go-live-precondition">
      <Badge size="sm" colorPalette={met ? "green" : "yellow"} flexShrink={0}>
        {met ? "Done" : "To do"}
      </Badge>
      <VStack align="start" gap={0}>
        <Text fontSize="sm">{met ? metText : unmetText}</Text>
        {!met && (
          <Text fontSize="xs" color="fg.muted">
            {next}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}
