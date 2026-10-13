/**
 * One person, group or API key on the Access tab: its roles summarised, and opened, each of
 * its grants with its end date, change and revoke. specs/identity/org-access-cluster.feature,
 * specs/rbac/roles-and-access-ui.feature
 */

import { UserAvatar } from "@langwatch/design-system/avatar";
import {
  Badge,
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ChevronDown, ChevronRight, KeyRound, Users } from "lucide-react";
import { useState } from "react";

import { type GrantRow, grantRowOf } from "../../../model/grants/grants.ts";
import type { Holder } from "../../../model/role-holders.ts";
import { CollapsedGrantList } from "../../blocks/collapsed-grants.tsx";
import { GrantsTable } from "./grants-table.tsx";

export function HolderRow({
  holder,
  nowMs,
  canManage,
  onChangeRole,
  onRevoke,
}: {
  holder: Holder;
  nowMs: number;
  canManage: boolean;
  onChangeRole: (grant: GrantRow) => void;
  onRevoke: (grant: GrantRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <Box
      width="full"
      borderBottomWidth="1px"
      borderColor="border.muted"
      data-testid="role-assignment-row"
    >
      <HStack paddingX={4} paddingY={3} gap={3} align="start">
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={open}
          aria-label={`Grants of ${holder.name}`}
          onClick={() => setOpen((isOpen) => !isOpen)}
        >
          <Chevron size={14} />
        </Button>
        {holder.kind === "person" && <UserAvatar size="sm" name={holder.name} src={holder.image} />}
        <VStack align="start" gap={0.5}>
          <HStack gap={2} flexWrap="wrap">
            <Text fontSize="sm" fontWeight="medium">
              {holder.name}
            </Text>
            <HolderKindBadge holder={holder} />
            {holder.kind === "group" && holder.directory && (
              <Badge
                size="sm"
                variant="outline"
                colorPalette="gray"
                title={`This group is managed by ${holder.directory}.`}
              >
                Directory
              </Badge>
            )}
          </HStack>
          {holder.address && (
            <Text fontSize="xs" color="fg.muted">
              {holder.address}
            </Text>
          )}
        </VStack>
        <Spacer />
        <CollapsedGrantList grants={holder.grants} />
      </HStack>
      {open && (
        <Box paddingX={4} paddingBottom={3}>
          <GrantsTable
            grants={holder.assignments.map((grant) => grantRowOf({ grant, nowMs }))}
            canManage={canManage}
            onChangeRole={onChangeRole}
            onRevoke={onRevoke}
          />
        </Box>
      )}
    </Box>
  );
}

/** What kind of holder this is, when it is not a person: it keeps a key's row countable. */
function HolderKindBadge({ holder }: { holder: Holder }) {
  if (holder.kind === "person") return null;
  const Icon = holder.kind === "group" ? Users : KeyRound;

  return (
    <HStack gap={2}>
      <Box color="fg.muted" display="flex" alignItems="center">
        <Icon size={12} aria-hidden />
      </Box>
      <Badge size="sm" variant="surface" colorPalette="gray">
        {holder.kind === "group" ? "Group" : "API key"}
      </Badge>
    </HStack>
  );
}
