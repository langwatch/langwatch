import { Alert, Link, Text } from "@chakra-ui/react";
import type { JoinLookupDecision } from "@langwatch/identity";

/**
 * "Acme Corp is already here — join instead?" (D12, epic Q17).
 *
 * A soft notice on the create-organization screen, and the word soft is the
 * whole specification: creating an organization on a matching domain is
 * NUDGED, never blocked. Somebody starting a second organization at a company
 * that already has one is doing something ordinary — a separate business
 * unit, a sandbox, a customer's workspace — and the only failure this notice
 * can have is standing in their way.
 *
 * So there is no confirmation, no interstitial and nothing disabled. The
 * notice names what exists, offers the way to it, and the form underneath it
 * still completes exactly as it did.
 *
 * Renders nothing when nothing is open to the address, which is most people.
 */
export function JoinInsteadNotice({
  lookup,
  joinHref = "/auth/join",
}: {
  /** What the server answered for this person's own verified address. Absent
   *  while in flight and whenever the flag is off — both render nothing. */
  lookup?: JoinLookupDecision;
  joinHref?: string;
}) {
  const organizations = openOrganizations(lookup);
  if (organizations.length === 0) return null;

  return (
    <Alert.Root
      status="info"
      width="full"
      size="sm"
      data-testid="join-instead-notice"
    >
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          <Text>
            {namesOf(organizations)} {organizations.length === 1 ? "is" : "are"}{" "}
            already on LangWatch with your email domain.{" "}
            <Link href={joinHref} variant="underline" fontWeight="medium">
              Join instead
            </Link>
            , or carry on and create a new one.
          </Text>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/** The organizations open to this address, in the one shape the notice needs.
 *  An automatic match answers the same way: it is still somewhere to go. */
function openOrganizations(
  lookup: JoinLookupDecision | undefined,
): readonly { name: string }[] {
  if (!lookup) return [];
  if (lookup.outcome === "none") return [];
  if (lookup.outcome === "auto") return [lookup.organization];
  return lookup.organizations;
}

/** Written out the way a person would say it: "Acme", "Acme and Beta",
 *  "Acme, Beta and Gamma". Never a truncated list with a count. */
function namesOf(organizations: readonly { name: string }[]): string {
  const names = organizations.map((organization) => organization.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
