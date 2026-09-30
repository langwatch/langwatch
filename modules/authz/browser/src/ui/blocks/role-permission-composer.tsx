// A role built one part of the product at a time: none, read or full access per
// resource, the single actions behind a disclosure (main's RolePermissionComposer).

import {
  Box,
  Button,
  chakra,
  HStack,
  Input,
  SegmentGroup,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { AuthzResource as OfferedResource } from "../../model/permission-catalogue.ts";
import {
  type AccessLevel,
  actionCopy,
  isReadOnlyResource,
  levelOf,
  offeredActions,
  offeredAreas,
  offeredPermissions,
  resourceCopy,
  setLevel,
  splitPermission,
  withDependencies,
  withoutDependents,
} from "../../model/role-permissions.ts";
import { PermissionToken } from "../elements/permission-token.tsx";

const PICKABLE_LEVELS: readonly AccessLevel[] = ["none", "read", "full"];

type Selection = {
  selected: AuthzPermission[];
  onChange: (next: AuthzPermission[]) => void;
};

export function RolePermissionComposer({ selected, onChange }: Selection) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Groups holding grants start open, so an editor sees what the role already says.
  const [openAreas, setOpenAreas] = useState<Set<string>>(() => areasHoldingSelections(selected));

  const searching = search.trim().length > 0;
  const visibleAreas = useMemo(
    () =>
      offeredAreas()
        .map((group) => ({
          ...group,
          resources: group.resources.filter((resource) =>
            resourceMatches({ resource, query: search }),
          ),
        }))
        .filter((group) => group.resources.length > 0),
    [search],
  );

  return (
    <VStack align="stretch" gap={3} width="full">
      <PermissionSearchField
        search={search}
        onSearchChange={setSearch}
        {...(selected.length > 0 ? { onClear: () => onChange([]) } : {})}
      />

      {visibleAreas.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          Nothing matches "{search}". Try the name of a screen, or part of a permission such as
          "datasets".
        </Text>
      ) : (
        visibleAreas.map((group) => (
          <AreaGroup
            key={group.area}
            area={group.area}
            resources={group.resources}
            selected={selected}
            onChange={onChange}
            // A search opens every group it touches: the reader asked to see these rows.
            open={searching || openAreas.has(group.area)}
            onToggle={() => setOpenAreas((current) => toggled(current, group.area))}
            expandedResources={expanded}
            onToggleResource={(resource) => setExpanded((current) => toggled(current, resource))}
          />
        ))
      )}
    </VStack>
  );
}

function toggled(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function areasHoldingSelections(selected: readonly AuthzPermission[]): Set<string> {
  return new Set(
    offeredAreas()
      .filter((group) =>
        group.resources.some((resource) =>
          offeredPermissions(resource).some((permission) => selected.includes(permission)),
        ),
      )
      .map((group) => group.area),
  );
}

/** One part of the product, closed to a line that still says how much it holds. */
function AreaGroup({
  area,
  resources,
  selected,
  onChange,
  open,
  onToggle,
  expandedResources,
  onToggleResource,
}: Selection & {
  area: string;
  resources: OfferedResource[];
  open: boolean;
  onToggle: () => void;
  expandedResources: ReadonlySet<string>;
  onToggleResource: (resource: string) => void;
}) {
  const held = resources.flatMap((resource) =>
    offeredPermissions(resource).filter((permission) => selected.includes(permission)),
  );

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="lg" overflow="hidden">
      <chakra.button
        type="button"
        display="flex"
        alignItems="center"
        width="full"
        paddingX={4}
        paddingY={3}
        gap={3}
        cursor="pointer"
        onClick={onToggle}
        aria-expanded={open}
        _hover={{ background: "bg.subtle" }}
        data-testid={`permission-area-${area}`}
      >
        <Text fontSize="sm" fontWeight="semibold">
          {area}
        </Text>
        {held.length > 0 && (
          <Box
            fontSize="xs"
            color="fg.muted"
            borderWidth="1px"
            borderColor="border"
            borderRadius="full"
            paddingX={2}
            paddingY={0.5}
          >
            {held.length} selected
          </Box>
        )}
        <Spacer />
        <Box color="fg.muted" display="flex" alignItems="center">
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </Box>
      </chakra.button>
      {open && (
        <VStack
          align="stretch"
          gap={0}
          borderTopWidth="1px"
          borderColor="border"
          separator={<Box height="1px" background="border" />}
        >
          {resources.map((resource) => (
            <ResourceRow
              key={resource}
              resource={resource}
              selected={selected}
              onChange={onChange}
              expanded={expandedResources.has(resource)}
              onToggleExpanded={() => onToggleResource(resource)}
            />
          ))}
        </VStack>
      )}
    </Box>
  );
}

/** Found by the screen's name, the words for what it allows, or half a permission string. */
function resourceMatches({ resource, query: raw }: { resource: OfferedResource; query: string }) {
  const query = raw.trim().toLowerCase();
  if (!query) return true;
  const copy = resourceCopy(resource);
  if (copy.label.toLowerCase().includes(query)) return true;
  if (copy.blurb.toLowerCase().includes(query)) return true;
  if (resource.toLowerCase().includes(query)) return true;
  return offeredPermissions(resource).some(
    (permission) =>
      permission.toLowerCase().includes(query) ||
      actionCopy(splitPermission(permission).action).label.toLowerCase().includes(query),
  );
}

function PermissionSearchField({
  search,
  onSearchChange,
  onClear,
}: {
  search: string;
  onSearchChange: (next: string) => void;
  /** Offered only once there is something to clear. */
  onClear?: () => void;
}) {
  return (
    <HStack gap={3}>
      <HStack
        flex={1}
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        paddingX={3}
        gap={2}
        // The wrapper is the field, so the wrapper wears the focus.
        _focusWithin={{
          borderColor: "colorPalette.solid",
          outline: "1px solid",
          outlineColor: "colorPalette.solid",
        }}
      >
        <Box color="fg.muted" display="flex" alignItems="center">
          <Search size={14} aria-hidden />
        </Box>
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search permissions"
          variant="subtle"
          background="transparent"
          border="none"
          outline="none"
          _focus={{ boxShadow: "none", outline: "none" }}
          size="sm"
          paddingX={0}
          aria-label="Search permissions"
        />
      </HStack>
      {onClear && (
        <Button size="xs" variant="ghost" onClick={onClear}>
          Clear all
        </Button>
      )}
    </HStack>
  );
}

function ResourceRow({
  resource,
  selected,
  onChange,
  expanded,
  onToggleExpanded,
}: Selection & {
  resource: OfferedResource;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const copy = resourceCopy(resource);
  const level = levelOf({ resource, selected });
  const held = offeredPermissions(resource).filter((permission) => selected.includes(permission));
  const canRefine = offeredActions(resource).length > 2;

  return (
    <VStack align="stretch" gap={2} paddingX={4} paddingY={3}>
      <HStack gap={4} align="start">
        <VStack align="start" gap={0.5} flex={1} minWidth={0}>
          <Text fontSize="sm" fontWeight="medium">
            {copy.label}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {copy.blurb}
          </Text>
        </VStack>
        <Spacer />
        <SegmentGroup.Root
          size="xs"
          value={level === "custom" ? null : level}
          onValueChange={(event) => {
            const next = PICKABLE_LEVELS.find((candidate) => candidate === event.value) ?? "none";
            onChange(setLevel({ resource, level: next, selected }));
          }}
          data-testid={`access-level-${resource}`}
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Item value="none">
            <SegmentGroup.ItemText>None</SegmentGroup.ItemText>
            <SegmentGroup.ItemHiddenInput />
          </SegmentGroup.Item>
          <SegmentGroup.Item value="read">
            <SegmentGroup.ItemText>Read</SegmentGroup.ItemText>
            <SegmentGroup.ItemHiddenInput />
          </SegmentGroup.Item>
          {!isReadOnlyResource(resource) && (
            <SegmentGroup.Item value="full">
              <SegmentGroup.ItemText>Full access</SegmentGroup.ItemText>
              <SegmentGroup.ItemHiddenInput />
            </SegmentGroup.Item>
          )}
        </SegmentGroup.Root>
        {canRefine && (
          <Tooltip content="Pick individual actions">
            <Button
              size="xs"
              variant="ghost"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              aria-label={`Choose actions for ${copy.label}`}
            >
              {expanded ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}
            </Button>
          </Tooltip>
        )}
      </HStack>

      {/* The tokens the level grants, as the audit log will show them. */}
      {held.length > 0 && !expanded && (
        <HStack gap={1.5} flexWrap="wrap">
          {held.map((permission) => (
            <PermissionToken key={permission} permission={permission} />
          ))}
        </HStack>
      )}

      {expanded && <ResourceActions resource={resource} selected={selected} onChange={onChange} />}
    </VStack>
  );
}

/**
 * The single actions. One that full access covers shows as held, and clicking
 * it withdraws the full access rather than pretending the two are independent.
 */
function ResourceActions({
  resource,
  selected,
  onChange,
}: Selection & { resource: OfferedResource }) {
  const permissions = offeredPermissions(resource);
  const managePermission = permissions.find(
    (permission) => splitPermission(permission).action === "manage",
  );
  const hasFullAccess = !!managePermission && selected.includes(managePermission);

  return (
    <VStack align="start" gap={2} paddingTop={1}>
      {permissions.map((permission) => {
        const impliedByFullAccess = permission !== managePermission && hasFullAccess;
        const target = impliedByFullAccess && managePermission ? managePermission : permission;
        const held = selected.includes(permission) || impliedByFullAccess;
        const actionWords = actionCopy(splitPermission(permission).action);

        return (
          <Checkbox
            key={permission}
            checked={held}
            onChange={() =>
              onChange(
                held
                  ? withoutDependents({ resource, permission: target, selected })
                  : withDependencies({ resource, permission: target, selected }),
              )
            }
          >
            <HStack gap={2} align="baseline">
              <Text fontSize="sm">{actionWords.label}</Text>
              <Text fontSize="xs" color="fg.muted">
                {actionWords.blurb}
              </Text>
              <PermissionToken permission={permission} />
            </HStack>
          </Checkbox>
        );
      })}
    </VStack>
  );
}
