import { Button, Text, VStack } from "@chakra-ui/react";
import type { JoinLookupDecision } from "@langwatch/identity";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { SHAPE } from "../authTheme";
import {
  type JoinableOrganization,
  resolveJoinBeforeCreate,
} from "../logic/joinBeforeCreate";
import { AuthPrimaryButton } from "./AuthPrimaryButton";

/**
 * Join before create (ADR-117 §6): the step between confirming an address and
 * creating a workspace, where somebody whose colleagues are already here is
 * offered their team instead of a second organization nobody meant to make.
 *
 * The order of the two actions is the whole point, and it is not a styling
 * choice: joining LEADS and creating is the explicit secondary. Today every
 * sign-up mints an organization unconditionally, which is why production
 * carries thousands of single-person workspaces people abandoned the moment
 * they found their real team.
 *
 * Nothing is looked up before the address is verified. `lookup` is only ever
 * passed once the caller holds a verified address — the query behind it is
 * disabled until then — and the decision refuses to render an organization
 * without one anyway, so no organization name reaches the browser early even
 * if a caller got that wrong.
 */
export function JoinBeforeCreateInterstitial({
  verifiedEmail,
  verified = true,
  lookup,
  pendingOrganizationId,
  onJoinOrganization,
  onCreateWorkspace,
  onAlreadyJoined,
}: {
  verifiedEmail: string;
  /** Whether the address has been proved. Defaults true: every caller today
   *  renders this step only after verification, and the flag exists so the
   *  decision can state that rather than assume it. */
  verified?: boolean;
  /** What the server answered for this address. Absent while in flight, and
   *  whenever the flag is off — both render nothing. */
  lookup?: JoinLookupDecision;
  pendingOrganizationId?: string | null;
  onJoinOrganization: (organization: JoinableOrganization) => void;
  onCreateWorkspace: () => void;
  /** Called when the organization admits this domain automatically. There is
   *  no choice left to make, so sign-up skips both the offer and workspace
   *  creation and the caller lands them inside. */
  onAlreadyJoined?: (organization: JoinableOrganization) => void;
}) {
  const decision = resolveJoinBeforeCreate({
    verifiedEmail,
    verified,
    lookup,
    pendingOrganizationId,
  });
  const nothingToOffer = decision.outcome === "create_workspace";
  const joinedAutomatically =
    decision.outcome === "already_joined" ? decision.organization : null;

  useEffect(() => {
    if (nothingToOffer) onCreateWorkspace();
  }, [nothingToOffer, onCreateWorkspace]);

  useEffect(() => {
    if (joinedAutomatically) onAlreadyJoined?.(joinedAutomatically);
  }, [joinedAutomatically, onAlreadyJoined]);

  // Both of these render nothing at all. "Nothing to offer" carries on to
  // workspace creation exactly as sign-up did before this step existed;
  // "already joined" skips the step entirely, because there is no choice left
  // to make.
  if (decision.outcome === "create_workspace") return null;
  if (decision.outcome === "already_joined") return null;

  if (decision.outcome === "awaiting_approval") {
    return (
      <AuthCard title="Waiting on an administrator">
        <VStack
          width="full"
          align="stretch"
          gap="14px"
          data-testid="join-before-create"
        >
          <Text fontSize="13.5px" lineHeight="1.65" color="fg.muted">
            Your request to join {decision.organization.name} is waiting for one
            of their administrators. We will email you either way.
          </Text>
          <SecondaryAction onClick={onCreateWorkspace}>
            Create a new organization anyway
          </SecondaryAction>
        </VStack>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Your colleagues are already here"
      intro="Join them instead of starting a separate workspace."
    >
      <VStack
        width="full"
        align="stretch"
        gap="14px"
        data-testid="join-before-create"
      >
        {decision.organizations.map((organization) => (
          // Joining LEADS, in the card's primary colour, and creating is the
          // explicit secondary underneath it. That order is the deliverable,
          // not a styling preference — see the note at the top of this file.
          <AuthPrimaryButton
            key={organization.id}
            onClick={() => onJoinOrganization(organization)}
          >
            Join {organization.name} ({colleagues(organization.colleagueCount)})
          </AuthPrimaryButton>
        ))}
        <SecondaryAction onClick={onCreateWorkspace}>
          Create a new organization
        </SecondaryAction>
      </VStack>
    </AuthCard>
  );
}

/** The way past the offer: available, and never the loud one. */
function SecondaryAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="outline"
      width="full"
      minHeight="44px"
      fontSize="14px"
      fontWeight={600}
      borderRadius={SHAPE.control}
      borderColor="auth.hairline"
      color="fg"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * The count as a stranger may read it: rounded upstream, and spelled out here
 * rather than abbreviated. "12 colleagues" says what it means; "12 coll." asks
 * the reader to guess.
 */
function colleagues(count: number): string {
  if (count <= 0) return "your team";
  return `${count}+ ${count === 1 ? "colleague" : "colleagues"}`;
}
