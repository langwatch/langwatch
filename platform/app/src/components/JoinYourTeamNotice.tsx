import { Alert, Button, HStack, Text } from "@chakra-ui/react";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { useSession } from "~/utils/auth-client";

/**
 * The post-login half of join-before-create (D12): an existing account whose
 * verified domain matches an organization is offered it too, not only somebody
 * mid-sign-up.
 *
 * Once, and dismissible, and both words are load-bearing. This is an offer
 * rather than a task: somebody who has already decided they do not want it
 * should never see it again, and somebody who has not decided should not have
 * to hunt for it. So "no thanks" is remembered on the ACCOUNT and per DOMAIN —
 * a person who changes jobs and verifies an address at their new employer is
 * offered that organization, because the decision they made was about the old
 * one.
 *
 * Renders nothing when nothing is open to the address, which is most people,
 * and nothing at all once it has been waved away.
 */
export function JoinYourTeamNotice() {
  // The shell renders on public pages too (a shared trace), where there is no
  // session to ask about — and a protected query fired there is a refusal
  // nobody asked for.
  const { data: session } = useSession();
  const offer = api.joinRequests.offer.useQuery(void 0, {
    enabled: !!session?.user,
  });
  const dismiss = api.joinRequests.dismissOffer.useMutation();
  const utils = api.useUtils();

  const decision = offer.data;
  if (!decision || decision.outcome === "none") return null;
  // An automatic match is not an offer to weigh — sign-up admits them. Nothing
  // to ask about here.
  if (decision.outcome === "auto") return null;
  if (decision.organizations.length === 0) return null;

  return (
    <Alert.Root status="info" width="full" data-testid="join-your-team-notice">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Your colleagues are already on LangWatch</Alert.Title>
        <Alert.Description>
          <Text>
            {namesOf(decision.organizations)} accepts people with your email
            domain. You can ask to join instead of working on your own.
          </Text>
        </Alert.Description>
      </Alert.Content>
      <HStack gap={2}>
        <Button
          size="xs"
          variant="ghost"
          loading={dismiss.isPending}
          data-testid="dismiss-join-offer"
          onClick={() =>
            dismiss.mutate(
              {},
              {
                onSuccess: () => void utils.joinRequests.offer.invalidate(),
                // Never `error.message`: the registry owns the words.
                onError: (error) =>
                  showErrorToast({
                    error,
                    fallbackTitle: "Couldn't dismiss that",
                  }),
              },
            )
          }
        >
          No thanks
        </Button>
        <Button size="xs" colorPalette="orange" asChild>
          <a href="/auth/join">Ask to join</a>
        </Button>
      </HStack>
    </Alert.Root>
  );
}

/** Written the way a person would say it: "Acme", "Acme and Beta". */
function namesOf(organizations: readonly { name: string }[]): string {
  const names = organizations.map((organization) => organization.name);
  if (names.length <= 1) return names[0] ?? "Your organization";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
