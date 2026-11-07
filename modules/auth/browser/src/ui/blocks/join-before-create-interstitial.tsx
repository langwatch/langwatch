import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, Button, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import type { JoinLookupDecision } from "@langwatch/identity-contract";
import { useEffect, useState } from "react";

import {
  type JoinableOrganization,
  resolveJoinBeforeCreate,
} from "../../model/join-before-create.ts";
import { AuthCard } from "../elements/auth-card.tsx";
import { FIELD_FOCUS, FIELD_SURFACE } from "../elements/front-door-field.tsx";
import { FrontDoorPrimaryButton } from "../elements/front-door-primary-button.tsx";

/** How many other organizations show before the list folds behind "Show all". */
const VISIBLE_OTHER_ORGANIZATIONS = 3;
/** The open list scrolls inside the card past about seven rows. */
const FULL_LIST_MAX_HEIGHT = "264px";

/** Offer to join existing organization before creating workspace; joining leads. */
export function JoinBeforeCreateInterstitial({
  verifiedEmail,
  verified = true,
  lookup,
  pendingOrganizationId,
  onJoinOrganization,
  onCreateWorkspace,
  onDeclineJoin = onCreateWorkspace,
  declining = false,
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
  /** Turning the offer down, which the caller records before moving on. */
  onDeclineJoin?: () => void;
  declining?: boolean;
  /** Called when the domain admitted them automatically: they are already a
   *  member, so sign-up skips both the offer and workspace creation. */
  onAlreadyJoined?: (organization: JoinableOrganization) => void;
}) {
  const decision = resolveJoinBeforeCreate({
    verifiedEmail,
    verified,
    lookup,
    pendingOrganizationId,
  });
  const nothingToOffer = decision.outcome === "create_workspace";
  const joinedAutomatically = decision.outcome === "already_joined" ? decision.organization : null;

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
      <AuthCard title="Your request is waiting">
        <Text data-testid="join-before-create">
          Your request to join {decision.organization.name} is waiting for one of their
          administrators. We will email you either way.
        </Text>
        <Button variant="outline" width="full" onClick={onCreateWorkspace}>
          Create a new organization anyway
        </Button>
      </AuthCard>
    );
  }

  // The list arrives ordered with the biggest team first, so that one leads.
  const [leading, ...others] = decision.organizations;
  if (!leading) return null;

  return (
    <AuthCard title="Join your colleagues">
      <Text data-testid="join-before-create">
        Your colleagues are already on LangWatch. Join them instead of starting a separate
        workspace.
      </Text>
      <FrontDoorPrimaryButton onClick={() => onJoinOrganization(leading)}>
        <Text as="span" truncate title={leading.name}>
          Join {leading.name} ({colleagues(leading.colleagueCount)})
        </Text>
      </FrontDoorPrimaryButton>
      {others.length > 0 ? (
        <OtherOrganizations organizations={others} onJoinOrganization={onJoinOrganization} />
      ) : null}
      <Button variant="outline" width="full" loading={declining} onClick={onDeclineJoin}>
        Create a new organization
      </Button>
    </AuthCard>
  );
}

/**
 * Every organization after the leading one, as quiet rows rather than more
 * primary buttons: a domain with dozens of organizations otherwise buries
 * its real team, and the way out, under a wall of equal calls to action.
 */
function OtherOrganizations({
  organizations,
  onJoinOrganization,
}: {
  organizations: readonly JoinableOrganization[];
  onJoinOrganization: (organization: JoinableOrganization) => void;
}) {
  const [showingAll, setShowingAll] = useState(false);
  const [query, setQuery] = useState("");

  const folds = organizations.length > VISIBLE_OTHER_ORGANIZATIONS;
  const searchable = folds && showingAll;
  const needle = query.trim().toLowerCase();
  let shown = organizations;
  if (searchable) shown = organizations.filter((o) => o.name.toLowerCase().includes(needle));
  else if (folds) shown = organizations.slice(0, VISIBLE_OTHER_ORGANIZATIONS);

  return (
    <VStack width="full" align="stretch" gap={2} data-testid="join-other-organizations">
      <Text textStyle="bodySm" color="fg.muted">
        Or join another organization
      </Text>
      {searchable ? (
        <Input
          size="sm"
          placeholder="Search organizations"
          aria-label="Search organizations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          {...FIELD_SURFACE}
          _focusVisible={FIELD_FOCUS}
        />
      ) : null}
      <Box
        as="ul"
        maxHeight={searchable ? FULL_LIST_MAX_HEIGHT : undefined}
        overflowY={searchable ? "auto" : undefined}
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
      >
        {shown.map((organization) => (
          <Box
            as="li"
            key={organization.id}
            _notLast={{ borderBottomWidth: "1px", borderColor: "border.muted" }}
          >
            <Button
              variant="ghost"
              size="sm"
              width="full"
              justifyContent="space-between"
              borderRadius="0"
              aria-label={`Join ${organization.name}`}
              onClick={() => onJoinOrganization(organization)}
            >
              <HStack width="full" justify="space-between" gap={3} minWidth={0}>
                <Text as="span" truncate title={organization.name}>
                  {organization.name}
                </Text>
                <Text as="span" textStyle="xs" color="fg.muted" flexShrink={0}>
                  {colleagues(organization.colleagueCount)}
                </Text>
              </HStack>
            </Button>
          </Box>
        ))}
        {shown.length === 0 ? (
          <Box as="li" paddingX={3}>
            <NoDataInfoBlock
              size="line"
              title={`No organization matches "${query.trim()}".`}
              action={{ label: "Clear search", onClick: () => setQuery("") }}
            />
          </Box>
        ) : null}
      </Box>
      {folds ? (
        <Button
          variant="ghost"
          size="sm"
          color="fg.muted"
          alignSelf="center"
          aria-expanded={showingAll}
          onClick={() => {
            setShowingAll((open) => !open);
            setQuery("");
          }}
        >
          {showingAll ? "Show fewer" : `Show all ${organizations.length} organizations`}
        </Button>
      ) : null}
    </VStack>
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
