import { Box, Button, Dialog, Portal, Text, VStack } from "@chakra-ui/react";
import { AuthPrimaryButton } from "~/features/auth/components/AuthPrimaryButton";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { useSession } from "~/utils/auth-client";

/**
 * "Your colleagues are already here" — as a WHOLE SCREEN, not a strip.
 *
 * WHY IT IS NOT A BANNER. This was an info alert pinned above the dashboard,
 * and the weight was wrong in both directions at once. It is the most
 * consequential thing we can tell somebody who has just landed — you are
 * about to build in a workspace of your own while your team is already here,
 * and every hour you spend before you notice is work in the wrong place — and
 * a strip above the page is what we use for "your trial ends Friday". So it
 * read as chrome, people scrolled past it, and the one action on it lost the
 * competition with the rest of the screen.
 *
 * A decision that changes where all of somebody's work lives gets the screen.
 * They answer it and carry on; the answer is remembered per ACCOUNT and per
 * DOMAIN, so nobody is asked twice, and somebody who changes jobs is asked
 * again about their new employer because the decision they made was about the
 * old one.
 *
 * IT IS ESCAPABLE, and that is what keeps it honest rather than a wall. "Not
 * now" is a real answer, it is remembered, and it is one press away. What it
 * is not is the quiet default — which is exactly what a banner made it.
 *
 * THE WAITING HALF. Asking is not joining: an administrator has to say yes.
 * Somebody who has asked and is waiting sees that here too rather than being
 * dropped back onto a dashboard that looks like nothing happened — which is
 * the moment people ask again, or give up and make the second workspace this
 * screen exists to prevent.
 */
export function JoinYourTeamTakeover() {
  // The shell renders on public pages too (a shared trace), where there is no
  // session to ask about — and a protected query fired there is a refusal
  // nobody asked for.
  const { data: session } = useSession();
  const enabled = !!session?.user;

  const offer = api.joinRequests.offer.useQuery(void 0, { enabled });
  const mine = api.joinRequests.mine.useQuery(void 0, { enabled });
  const dismiss = api.joinRequests.dismissOffer.useMutation();
  const askToJoin = api.joinRequests.request.useMutation();
  const utils = api.useUtils();

  // Nothing is decided until BOTH answers are in. Rendering the offer while
  // the pending query is still in flight would show "ask to join" to somebody
  // who already asked — the same class of mistake that made the old button
  // look inert.
  if (offer.isPending || mine.isPending) return null;

  const decision = offer.data;
  const waiting = mine.data?.[0] ?? null;

  if (waiting) {
    const name =
      decision && decision.outcome === "ask"
        ? (decision.organizations.find(
            (organization) =>
              organization.organizationId === waiting.organizationId,
          )?.name ?? null)
        : null;
    return (
      <Takeover title="Waiting for an administrator" testId="join-team-waiting">
        <Text fontSize="14px" lineHeight="1.65" color="fg.muted">
          {name === null
            ? "Your request to join is with the administrators."
            : `Your request to join ${name} is with their administrators.`}{" "}
          We will email you as soon as somebody answers, either way. There is
          nothing else for you to do.
        </Text>
        <SecondaryAction
          onClick={() => void utils.joinRequests.mine.invalidate()}
        >
          Check again
        </SecondaryAction>
      </Takeover>
    );
  }

  if (!decision || decision.outcome === "none") return null;
  // An automatic match is not an offer to weigh — the arrival admits them.
  if (decision.outcome === "auto") return null;
  if (decision.organizations.length === 0) return null;

  const refuse = () =>
    dismiss.mutate(
      {},
      {
        onSuccess: () => void utils.joinRequests.offer.invalidate(),
        // Never `error.message`: the code-keyed registry owns the words.
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't save that" }),
      },
    );

  const ask = (organizationId: string) =>
    askToJoin.mutate(
      { organizationId },
      {
        onSuccess: () => {
          // Straight to the waiting half, from the same queries that drew
          // this one. Nothing navigates and nothing is created.
          void utils.joinRequests.mine.invalidate();
          void utils.joinRequests.offer.invalidate();
        },
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't ask to join" }),
      },
    );

  return (
    <Takeover
      title="Your colleagues are already here"
      intro="Join them instead of building in a workspace of your own."
      testId="join-team-takeover"
    >
      {decision.organizations.map((organization) => (
        // Joining LEADS. Creating your own is what happens if you decline,
        // and it is already what you have — so it needs no button here.
        <AuthPrimaryButton
          key={organization.organizationId}
          loading={askToJoin.isPending}
          onClick={() => ask(organization.organizationId)}
        >
          Ask to join {organization.name}
        </AuthPrimaryButton>
      ))}
      <SecondaryAction loading={dismiss.isPending} onClick={refuse}>
        Not now — keep working on my own
      </SecondaryAction>
      <Text fontSize="12.5px" color="fg.subtle" textAlign="center">
        We will not ask about this domain again.
      </Text>
    </Takeover>
  );
}

/**
 * The screen itself: a modal that cannot be dismissed by clicking past it.
 *
 * Not because the answer is compulsory — "not now" is right there — but
 * because a click on the backdrop is not an answer, and treating it as one is
 * how a person ends up asked again tomorrow having believed they had decided.
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
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root
      open
      size="cover"
      placement="center"
      closeOnInteractOutside={false}
      closeOnEscape={false}
      // Nothing to call: the screen closes by being answered.
      onOpenChange={() => void 0}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid={testId} bg="bg" borderRadius={0}>
            <Dialog.Body
              display="flex"
              alignItems="center"
              justifyContent="center"
              padding={6}
            >
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
                    <Text
                      fontSize="14px"
                      color="fg.muted"
                      textAlign="center"
                      paddingTop="6px"
                    >
                      {intro}
                    </Text>
                  )}
                </Box>
                {children}
              </VStack>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/** The way past, available and never the loud one. */
function SecondaryAction({
  onClick,
  loading,
  children,
}: {
  onClick: () => void;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="outline"
      width="full"
      minHeight="44px"
      fontSize="14px"
      fontWeight={600}
      loading={loading}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
