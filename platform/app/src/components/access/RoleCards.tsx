import {
  Box,
  Button,
  Card,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { format } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { ProviderScopeChips } from "../settings/ProviderScopeChips";
import { Tooltip } from "../ui/tooltip";
import { IdentityChip } from "./IdentityRow";
import { PermissionTokenList } from "./PermissionToken";
import { roleTone } from "./roleAssignments";
import type { GrantScope, Holder } from "./roleHolders";
import {
  BUILTIN_TIER_COPY,
  type BuiltinTier,
  headlinePermissions,
  permissionsNeedingOrganizationScope,
} from "./rolePermissions";

const TIER_TONE: Record<BuiltinTier, string> = {
  admin: roleTone("ADMIN"),
  member: roleTone("MEMBER"),
  viewer: roleTone("VIEWER"),
};

/**
 * One of the three roles every organization starts with.
 *
 * The cards are a ladder, because that is what the roles are: viewer is the
 * base, member adds to it, admin adds to that, and the code declares them in
 * exactly those terms. So each card names what its tier ADDS rather than
 * repeating three overlapping lists of sixty permissions at a reader who then
 * has to diff them by eye. The tokens shown are computed from the difference,
 * so they cannot drift from what the role actually grants.
 */
export function BuiltinRoleCard({
  tier,
  people,
  onOpenDetail,
}: {
  tier: BuiltinTier;
  /** How many people hold it, or null when that could not be read. */
  people: number | null;
  onOpenDetail: () => void;
}) {
  const copy = BUILTIN_TIER_COPY[tier];
  const { shown, total } = headlinePermissions(tier);

  return (
    <Card.Root
      width="full"
      height="full"
      variant="outline"
      borderColor="border.muted"
      colorPalette={TIER_TONE[tier]}
      _hover={{ borderColor: "border.emphasized", boxShadow: "sm" }}
      // The border and the shadow lift together, on the same ease — a card
      // that changes one without the other reads as two separate reactions.
      transition="border-color 0.15s ease, box-shadow 0.15s ease"
      data-testid={`builtin-role-${tier}`}
    >
      <Card.Body display="flex" flexDirection="column" gap={2.5} padding={4}>
        <HStack width="full" align="baseline" gap={2}>
          {/* The tier's tone lives in one quiet dot rather than a painted
              edge: the ladder is the information, and a coloured spine made
              three peers read as three alerts. */}
          <Box
            width="7px"
            height="7px"
            borderRadius="full"
            backgroundColor="colorPalette.solid"
            alignSelf="center"
            flexShrink={0}
          />
          <Text fontWeight="semibold" fontSize="sm">
            {copy.name}
          </Text>
          <Spacer />
          <PeopleCount people={people} />
        </HStack>

        <Text fontSize="xs" color="fg.muted" lineHeight="1.5">
          {copy.summary}
        </Text>

        <Spacer />

        <VStack
          align="start"
          gap={2}
          width="full"
          borderTopWidth="1px"
          borderColor="border.muted"
          paddingTop={2.5}
        >
          <SectionEyebrow>
            {copy.inheritsFrom
              ? `Everything ${BUILTIN_TIER_COPY[copy.inheritsFrom].name} has, and`
              : "The base every other role builds on"}
          </SectionEyebrow>
          <PermissionTokenList permissions={shown} limit={shown.length} />
          <Text fontSize="xs" color="fg.subtle">
            {total} permissions in total
          </Text>
        </VStack>

        <Button
          size="xs"
          variant="ghost"
          color="fg.muted"
          alignSelf="start"
          onClick={onOpenDetail}
        >
          See what it can do
        </Button>
      </Card.Body>
    </Card.Root>
  );
}

function PeopleCount({ people }: { people: number | null }) {
  if (people === null) {
    return (
      <Text fontSize="xs" color="fg.subtle">
        Holders unavailable
      </Text>
    );
  }
  return (
    <Tooltip content="Counted from the role assignments in this organization, including people who hold it through a group.">
      <Text fontSize="xs" color="fg.muted">
        {people} {people === 1 ? "person" : "people"}
      </Text>
    </Tooltip>
  );
}

/**
 * A role somebody here wrote, and everything a reader needs to judge it.
 *
 * A custom role exists because somebody needed one thing and nothing else, so
 * the card leads with what it grants and who is holding it. The scopes come
 * from where it was actually assigned rather than from the role itself — a
 * role definition has no scope; the assignment does — which is also why a role
 * nobody holds says so plainly instead of showing an empty strip.
 */
export function CustomRoleCard({
  role,
  holders,
  scopes,
  people,
  canManage,
  onOpenDetail,
  onEdit,
  onDelete,
}: {
  role: {
    id: string;
    name: string;
    description: string | null;
    permissions: string[];
    createdAt: Date | string;
  };
  holders: Holder[];
  scopes: GrantScope[];
  people: number | null;
  canManage: boolean;
  onOpenDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const inert = permissionsNeedingOrganizationScope(role.permissions);
  const assignedBelowOrganizationOnly =
    scopes.length > 0 &&
    !scopes.some((scope) => scope.scopeType === "ORGANIZATION") &&
    inert.length > 0;

  return (
    <Card.Root
      width="full"
      variant="outline"
      borderColor="border.muted"
      _hover={{ borderColor: "border.emphasized", boxShadow: "sm" }}
      // The border and the shadow lift together, on the same ease — a card
      // that changes one without the other reads as two separate reactions.
      transition="border-color 0.15s ease, box-shadow 0.15s ease"
      data-testid={`custom-role-${role.id}`}
    >
      <Card.Body display="flex" flexDirection="column" gap={3} padding={4}>
        <HStack width="full" align="start" gap={3}>
          <VStack align="start" gap={1} flex={1} minWidth={0}>
            <Text fontWeight="semibold" fontSize="sm">
              {role.name}
            </Text>
            {role.description ? (
              <Text fontSize="xs" color="fg.muted" lineHeight="1.5">
                {role.description}
              </Text>
            ) : null}
          </VStack>
          <HStack gap={2} flexShrink={0}>
            <PeopleCount people={people} />
            {canManage && (
              <HStack gap={0.5}>
                <Tooltip content="Edit this role">
                  <Button
                    size="xs"
                    variant="ghost"
                    color="fg.muted"
                    aria-label="Edit this role"
                    onClick={onEdit}
                  >
                    <Pencil size={14} aria-hidden />
                  </Button>
                </Tooltip>
                <Tooltip content="Delete this role">
                  <Button
                    size="xs"
                    variant="ghost"
                    color="fg.muted"
                    aria-label="Delete this role"
                    _hover={{ color: "red.solid" }}
                    onClick={onDelete}
                  >
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </Tooltip>
              </HStack>
            )}
          </HStack>
        </HStack>

        <CardSection>
          <SectionEyebrow>Grants</SectionEyebrow>
          <PermissionTokenList permissions={role.permissions} limit={6} />
          <Button
            size="xs"
            variant="plain"
            padding={0}
            color="fg.muted"
            onClick={onOpenDetail}
          >
            See all {role.permissions.length}{" "}
            {role.permissions.length === 1 ? "permission" : "permissions"}
          </Button>
        </CardSection>

        <CardSection>
          <SectionEyebrow>In force on</SectionEyebrow>
          {scopes.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              Nowhere yet. This role grants nothing until somebody is assigned
              it.
            </Text>
          ) : (
            <ProviderScopeChips
              scopes={scopes.map((scope) => ({
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                name: scope.scopeName ?? undefined,
              }))}
            />
          )}
          {assignedBelowOrganizationOnly && (
            <Text fontSize="xs" color="fg.muted">
              {inert.length}{" "}
              {inert.length === 1 ? "permission takes" : "permissions take"}{" "}
              effect only where this role is assigned on the organization.
            </Text>
          )}
        </CardSection>

        <CardSection>
          <SectionEyebrow>Held by</SectionEyebrow>
          <RoleHolderStrip holders={holders} people={people} />
        </CardSection>

        <Text fontSize="xs" color="fg.subtle">
          Created {format(new Date(role.createdAt), "d MMM yyyy")}
        </Text>
      </Card.Body>
    </Card.Root>
  );
}

/** The tracked, quiet label every card section leads with — the same
 *  register as the stat-tile labels on the directory overview, so the two
 *  screens read as one system. Exported for the role dialogs, whose section
 *  labels are the same thing said in a different container. */
export function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <Text
      fontSize="10px"
      fontWeight="medium"
      color="fg.subtle"
      textTransform="uppercase"
      letterSpacing="0.08em"
    >
      {children}
    </Text>
  );
}

/** A hairline-topped block, so the card is divided by rules rather than by
 *  floating gaps — the mockups' idiom. */
function CardSection({ children }: { children: React.ReactNode }) {
  return (
    <VStack
      align="start"
      gap={2}
      width="full"
      borderTopWidth="1px"
      borderColor="border.muted"
      paddingTop={2.5}
    >
      {children}
    </VStack>
  );
}

function RoleHolderStrip({
  holders,
  people,
}: {
  holders: Holder[];
  people: number | null;
}) {
  if (people === null) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        Who holds this could not be read.
      </Text>
    );
  }

  if (holders.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Nobody yet.
      </Text>
    );
  }

  const shown = holders.slice(0, 5);
  const remaining = holders.length - shown.length;

  return (
    <HStack gap={2} flexWrap="wrap">
      {shown.map((holder) => (
        <HStack
          key={holder.key}
          gap={1.5}
          borderWidth="1px"
          borderColor="border"
          borderRadius="full"
          paddingLeft={1}
          paddingRight={2.5}
          paddingY={0.5}
        >
          <RandomColorAvatar
            id={holder.userId ?? holder.key}
            size="2xs"
            name={holder.name}
            image={holder.image}
          />
          <Text fontSize="xs">
            {holder.kind === "group" ? `via ${holder.name}` : holder.name}
          </Text>
          {holder.kind === "group" && holder.directory ? (
            <IdentityChip
              label="Directory"
              title={`This group is managed by ${holder.directory}.`}
            />
          ) : null}
        </HStack>
      ))}
      {remaining > 0 && (
        <Box fontSize="xs" color="fg.muted">
          and {remaining} more
        </Box>
      )}
    </HStack>
  );
}
