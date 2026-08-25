import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { SelfServeGoLiveView } from "@langwatch/identity-server";
import { api } from "../../../utils/api";
import { IdentityChip } from "../../access/IdentityRow";
import { reportRefusal } from "./refusals";

/**
 * The last step, as a checklist rather than a verdict.
 *
 * All three preconditions are shown, met or not, with the thing that would
 * meet each one named beside it. The server refuses ONE at a time — each
 * with its own code and its own registered words — because a mutation has to
 * answer with the next thing to do; the screen shows all three at once
 * because a person planning an afternoon has to see what the afternoon
 * contains.
 *
 * There is no suspend here and there will not be. The lever for a connection
 * that is actively hurting people is a LangWatch operator's, taken by a human
 * in the moment it matters — putting it on this screen would put it behind
 * the identity provider that is failing.
 */
export function GoLiveSection({
  organizationId,
  connectionId,
  canManage,
  goLive,
}: {
  organizationId: string;
  connectionId: string;
  canManage: boolean;
  goLive: SelfServeGoLiveView | null;
}) {
  const activate = api.ssoSetup.activate.useMutation();
  const utils = api.useUtils();

  if (!goLive) {
    return (
      <Text color="fg.muted">
        We could not read where this connection stands. Reload the page.
      </Text>
    );
  }

  if (goLive.activated) {
    return (
      <Text color="fg.muted" fontSize="sm">
        This connection is on. The banner at the top of the page says whether
        sign-in is being decided by it yet.
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={3}>
      <Precondition
        met={goLive.domainProved}
        metText="A domain of yours is proved"
        unmetText="No domain of yours is proved yet"
        next="Claim a domain in step 2 and publish the record we give you."
      />
      <Precondition
        met={goLive.testSignIn.done}
        metText="Somebody has signed in through the connection"
        unmetText="Nobody has signed in through the connection yet"
        next="Use the test sign-in in step 3."
      />
      <Precondition
        met={goLive.breakGlass.inPlace}
        metText="Somebody can still get in without the identity provider"
        unmetText="Nobody can get in without the identity provider"
        next="Grant a way back in in step 4."
      />
      {canManage &&
        (goLive.ready ? (
          <Button
            alignSelf="start"
            loading={activate.isPending}
            onClick={() =>
              activate.mutate(
                { organizationId, connectionId },
                {
                  onSuccess: () => void utils.ssoSetup.getSetup.invalidate(),
                  onError: reportRefusal,
                },
              )
            }
          >
            Go live
          </Button>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            Finish the steps above and this turns into a button.
          </Text>
        ))}
    </VStack>
  );
}

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
    <HStack align="start" gap={3}>
      <IdentityChip
        label={met ? "Done" : "To do"}
        tone={met ? "good" : "warning"}
      />
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
