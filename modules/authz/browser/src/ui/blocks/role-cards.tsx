// The role cards (main's RoleCards): a predefined tier names what it adds to the one
// below; a custom role shows what it grants, where it is in force and who holds it.

import { Card } from "@langwatch/design-system/card";
import { Badge, Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ProviderScopeChips } from "@langwatch/design-system/provider-scope-chips";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { format } from "@langwatch/time";
import { Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import type { BuiltinRoleCard as BuiltinRole } from "../../model/builtin-roles.ts";
import type { GrantScope, Holder } from "../../model/role-holders.ts";
import { permissionsNeedingOrganizationScope } from "../../model/role-permissions.ts";
import { PermissionTokenList } from "../elements/permission-token.tsx";
import { PrincipalAvatar } from "../elements/principal-avatar.tsx";

const TIER_TONE = { ADMIN: "warning", MEMBER: "ok", VIEWER: "neutral" } as const;

export function BuiltinRoleCard({
  card,
  people,
  totalPermissions,
  onOpenDetail,
}: {
  card: BuiltinRole;
  /** How many people hold it, or null when that could not be read. */
  people: number | null;
  totalPermissions: number;
  onOpenDetail: () => void;
}) {
  return (
    <Card
      titleLevel={3}
      status={TIER_TONE[card.teamRole]}
      title={card.name}
      badge={<PeopleCount people={people} />}
      description={card.description}
      bodyLayout="spaced"
      footer={
        <Button size="xs" variant="ghost" color="fg.muted" onClick={onOpenDetail}>
          See what it can do
        </Button>
      }
      data-testid={`builtin-role-${card.teamRole.toLowerCase()}`}
    >
      <CardSection>
        <SectionEyebrow>
          {card.inheritsFrom
            ? `Everything ${card.inheritsFrom} has, and`
            : "The base every other role builds on"}
        </SectionEyebrow>
        <PermissionTokenList permissions={card.headline} limit={card.headline.length} readable />
        <Text textStyle="caption" color="fg.subtle">
          {totalPermissions} permissions in total
        </Text>
      </CardSection>
    </Card>
  );
}

function PeopleCount({ people }: { people: number | null }) {
  if (people === null) {
    return (
      <Text textStyle="caption" color="fg.subtle">
        Holders unavailable
      </Text>
    );
  }
  return (
    <Tooltip content="Counted from the role assignments in this organization, including people who hold it through a group.">
      <Text textStyle="caption" color="fg.muted">
        {people} {people === 1 ? "person" : "people"}
      </Text>
    </Tooltip>
  );
}

/** A role somebody here wrote; its scopes come from where it was assigned. */
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
    permissions: readonly string[];
    /** As the wire carries it; null on a built-in role. */
    createdAt: string | null;
  };
  holders: readonly Holder[];
  scopes: readonly GrantScope[];
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
    <Card
      titleLevel={3}
      title={role.name}
      description={role.description ?? void 0}
      badge={<PeopleCount people={people} />}
      actions={
        canManage ? (
          <>
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
          </>
        ) : (
          void 0
        )
      }
      bodyLayout="spaced"
      data-testid={`custom-role-${role.id}`}
    >
      <CardSection>
        <SectionEyebrow>Grants</SectionEyebrow>
        <PermissionTokenList permissions={role.permissions} limit={6} />
        <Button size="xs" variant="plain" padding={0} color="fg.muted" onClick={onOpenDetail}>
          See all {role.permissions.length}{" "}
          {role.permissions.length === 1 ? "permission" : "permissions"}
        </Button>
      </CardSection>

      <CardSection>
        <SectionEyebrow>In force on</SectionEyebrow>
        {scopes.length === 0 ? (
          <Text textStyle="body" color="fg.muted">
            Nowhere yet. This role grants nothing until somebody is assigned it.
          </Text>
        ) : (
          <ProviderScopeChips
            scopes={scopes.map((scope) => ({
              scopeType: scope.scopeType,
              scopeId: scope.scopeId,
              ...(scope.scopeName ? { name: scope.scopeName } : {}),
            }))}
          />
        )}
        {assignedBelowOrganizationOnly && (
          <Text textStyle="caption" color="fg.muted">
            {inert.length} {inert.length === 1 ? "permission takes" : "permissions take"} effect
            only where this role is assigned on the organization.
          </Text>
        )}
      </CardSection>

      <CardSection>
        <SectionEyebrow>Held by</SectionEyebrow>
        <RoleHolderStrip holders={holders} people={people} />
      </CardSection>

      {role.createdAt && (
        <Text textStyle="caption" color="fg.subtle">
          Created {format(role.createdAt, "d MMM yyyy")}
        </Text>
      )}
    </Card>
  );
}

/** The quiet label every card section, and the role detail dialog, leads with. */
export function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="eyebrow" color="fg.subtle">
      {children}
    </Text>
  );
}

function CardSection({ children }: { children: ReactNode }) {
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
  holders: readonly Holder[];
  people: number | null;
}) {
  if (people === null) {
    return (
      <Text textStyle="body" color="fg.subtle">
        Who holds this could not be read.
      </Text>
    );
  }
  if (holders.length === 0) {
    return (
      <Text textStyle="body" color="fg.muted">
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
          <PrincipalAvatar
            id={holder.userId ?? holder.key}
            size="2xs"
            name={holder.name}
            image={holder.image}
          />
          <Text textStyle="caption">
            {holder.kind === "group" ? `via ${holder.name}` : holder.name}
          </Text>
          {holder.kind === "group" && holder.directory ? (
            <Badge
              size="xs"
              variant="outline"
              title={`This group is managed by ${holder.directory}.`}
            >
              Directory
            </Badge>
          ) : null}
        </HStack>
      ))}
      {remaining > 0 && (
        <Box textStyle="caption" color="fg.muted">
          and {remaining} more
        </Box>
      )}
    </HStack>
  );
}
