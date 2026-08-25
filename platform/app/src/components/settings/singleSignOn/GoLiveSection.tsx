import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { SelfServeGoLiveView } from "@langwatch/identity-server";
import { ArrowRight } from "lucide-react";
import { api } from "../../../utils/api";
import { IdentityChip } from "../../access/IdentityRow";
import { Link } from "../../ui/link";
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
      <VStack align="start" gap={3}>
        <Text color="fg.muted" fontSize="sm">
          This connection is on. The banner at the top of the page says whether
          sign-in is being decided by it yet.
        </Text>
        <Text color="fg.muted" fontSize="sm">
          Next, your identity provider can create and remove accounts here as
          people join and leave — set that up in Directory.
        </Text>
        <Link href="/settings/directory">
          <Button size="sm" variant="outline">
            Set up provisioning
            <ArrowRight size={14} />
          </Button>
        </Link>
      </VStack>
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
          // THE DECISION THIS WHOLE PAGE LEADS TO, at the weight of one. It
          // drew as a small grey button underneath a column of green ticks,
          // which made the checklist louder than the thing the checklist was
          // for — the reader's eye landed on what was already done rather
          // than on what to do. Green because every settled state above it is
          // green, and this is the step that settles the connection itself.
          <Button
            alignSelf="start"
            size="lg"
            colorPalette="green"
            marginTop={2}
            loading={activate.isPending}
            onClick={() =>
              activate.mutate(
                { organizationId, connectionId },
                {
                  onSuccess: async () => {
                    await utils.ssoSetup.getSetup.invalidate();
                  },
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
