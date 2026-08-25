import {
  Box,
  Button,
  Card,
  HStack,
  Separator,
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
      borderWidth="1px"
      borderColor="border"
      borderLeftWidth="3px"
      colorPalette={TIER_TONE[tier]}
      borderLeftColor="colorPalette.emphasized"
      data-testid={`builtin-role-${tier}`}
    >
      <Card.Body display="flex" flexDirection="column" gap={3} padding={5}>
        <HStack width="full" align="baseline">
          <Text fontWeight="semibold" fontSize="md">
            {copy.name}
          </Text>
          <Spacer />
          <PeopleCount people={people} />
        </HStack>

        <Text fontSize="sm" color="fg.muted">
          {copy.summary}
        </Text>

        <Spacer />

        <VStack align="start" gap={2} width="full">
          <Text fontSize="xs" color="fg.subtle">
            {copy.inheritsFrom
              ? `Everything ${BUILTIN_TIER_COPY[copy.inheritsFrom].name} has, and:`
              : "The base every other role builds on:"}
          </Text>
          <PermissionTokenList permissions={shown} limit={shown.length} />
          <Text fontSize="xs" color="fg.subtle">
            {total} permissions in total
          </Text>
        </VStack>

        <Button
          size="xs"
          variant="outline"
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
      borderWidth="1px"
      borderColor="border"
      data-testid={`custom-role-${role.id}`}
    >
      <Card.Body display="flex" flexDirection="column" gap={4} padding={5}>
        <HStack width="full" align="start" gap={3}>
          <VStack align="start" gap={1} flex={1} minWidth={0}>
            <Text fontWeight="semibold" fontSize="md">
              {role.name}
            </Text>
            {role.description ? (
              <Text fontSize="sm" color="fg.muted">
                {role.description}
              </Text>
            ) : null}
            <Text fontSize="xs" color="fg.subtle">
              Created {format(new Date(role.createdAt), "d MMM yyyy")}
            </Text>
          </VStack>
          {canManage && (
            <HStack gap={1}>
              <Tooltip content="Edit this role">
                <Button size="xs" variant="ghost" onClick={onEdit}>
                  <Pencil size={14} aria-hidden />
                  Edit
                </Button>
              </Tooltip>
              <Tooltip content="Delete this role">
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="red"
                  onClick={onDelete}
                >
                  <Trash2 size={14} aria-hidden />
                  Delete
                </Button>
              </Tooltip>
            </HStack>
          )}
        </HStack>

        <Separator />

        <VStack align="start" gap={2} width="full">
          <Text fontSize="xs" color="fg.subtle">
            Grants
          </Text>
          <PermissionTokenList permissions={role.permissions} limit={6} />
          <Button size="xs" variant="plain" padding={0} onClick={onOpenDetail}>
            See all {role.permissions.length}{" "}
            {role.permissions.length === 1 ? "permission" : "permissions"}
          </Button>
        </VStack>

        <VStack align="start" gap={2} width="full">
          <Text fontSize="xs" color="fg.subtle">
            In force on
          </Text>
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
        </VStack>

        {assignedBelowOrganizationOnly && (
          <Text fontSize="xs" color="fg.muted">
            {inert.length}{" "}
            {inert.length === 1 ? "permission takes" : "permissions take"}{" "}
            effect only where this role is assigned on the organization.
          </Text>
        )}

        <VStack align="start" gap={2} width="full">
          <Text fontSize="xs" color="fg.subtle">
            Held by
          </Text>
          <RoleHolderStrip holders={holders} people={people} />
        </VStack>
      </Card.Body>
    </Card.Root>
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
