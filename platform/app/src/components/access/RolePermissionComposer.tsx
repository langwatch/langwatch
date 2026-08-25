import {
  Box,
  Button,
  HStack,
  Input,
  SegmentGroup,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { AuthzPermission } from "@langwatch/authz";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Resource } from "~/utils/rbacVocabulary";
import { Checkbox } from "../ui/checkbox";
import { Tooltip } from "../ui/tooltip";
import { PermissionToken } from "./PermissionToken";
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
} from "./rolePermissions";

/**
 * Building a role, one part of the product at a time.
 *
 * The permission list is long and mostly answered the same way: an
 * administrator writing "support, read-only" is not choosing between `create`
 * and `update` on twenty resources, they are saying "read the traces, read the
 * annotations, nothing else". So the ordinary control is a three-way choice
 * per thing — none, read, or full access — and the individual actions stay
 * behind a disclosure for the role that genuinely needs "create but never
 * delete".
 *
 * Everything is named twice: what a customer calls the thing, and the
 * permission string the grant is actually made of. The reader needs the first
 * to decide and the second to recognise it again in the audit log.
 */
export function RolePermissionComposer({
  selected,
  onChange,
}: {
  selected: AuthzPermission[];
  onChange: (next: AuthzPermission[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const areas = useMemo(() => offeredAreas(), []);
  const visibleAreas = useMemo(
    () =>
      areas
        .map((group) => ({
          ...group,
          resources: group.resources.filter((resource) =>
            resourceMatches({ resource, query: search }),
          ),
        }))
        .filter((group) => group.resources.length > 0),
    [areas, search],
  );

  const toggleExpanded = (resource: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(resource)) next.delete(resource);
      else next.add(resource);
      return next;
    });

  return (
    <VStack align="stretch" gap={4} width="full">
      <PermissionSearchField
        search={search}
        onSearchChange={setSearch}
        onClear={selected.length > 0 ? () => onChange([]) : undefined}
      />

      {visibleAreas.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          Nothing matches "{search}". Try the name of a screen, or part of a
          permission such as "datasets".
        </Text>
      ) : (
        visibleAreas.map((group) => (
          <VStack key={group.area} align="stretch" gap={2}>
            <Text
              fontSize="xs"
              fontWeight="semibold"
              letterSpacing="wide"
              textTransform="uppercase"
              color="fg.muted"
            >
              {group.area}
            </Text>
            <VStack
              align="stretch"
              gap={0}
              borderWidth="1px"
              borderColor="border"
              borderRadius="md"
              separator={<Box height="1px" background="border" />}
            >
              {group.resources.map((resource) => (
                <ResourceRow
                  key={resource}
                  resource={resource}
                  selected={selected}
                  onChange={onChange}
                  expanded={expanded.has(resource)}
                  onToggleExpanded={() => toggleExpanded(resource)}
                />
              ))}
            </VStack>
          </VStack>
        ))
      )}
    </VStack>
  );
}

/**
 * Whether a resource answers what was typed.
 *
 * The reader may be searching by the name of a screen, by the word for what
 * they want to allow, or by half a permission string they saw in the audit
 * log, so all three find it.
 */
function resourceMatches({
  resource,
  query: raw,
}: {
  resource: Resource;
  query: string;
}): boolean {
  const query = raw.trim().toLowerCase();
  if (!query) return true;
  const copy = resourceCopy(resource);
  if (copy.label.toLowerCase().includes(query)) return true;
  if (copy.blurb.toLowerCase().includes(query)) return true;
  if (resource.toLowerCase().includes(query)) return true;
  return offeredPermissions(resource).some(
    (permission) =>
      permission.toLowerCase().includes(query) ||
      actionCopy(splitPermission(permission).action)
        .label.toLowerCase()
        .includes(query),
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
      >
        <Box color="fg.muted" display="flex" alignItems="center">
          <Search size={14} aria-hidden />
        </Box>
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search permissions"
          variant="flushed"
          border="none"
          size="sm"
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
}: {
  resource: Resource;
  selected: AuthzPermission[];
  onChange: (next: AuthzPermission[]) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const copy = resourceCopy(resource);
  const level = levelOf({ resource, selected });
  const readOnly = isReadOnlyResource(resource);
  const actions = offeredActions(resource);
  const held = offeredPermissions(resource).filter((permission) =>
    selected.includes(permission),
  );
  const canRefine = actions.length > 2;

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
            const next = (event.value ?? "none") as AccessLevel;
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
          {!readOnly && (
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

      {level === "custom" && !expanded && (
        <HStack gap={1.5} flexWrap="wrap">
          {held.map((permission) => (
            <PermissionToken key={permission} permission={permission} />
          ))}
        </HStack>
      )}

      {expanded && (
        <ResourceActions
          resource={resource}
          selected={selected}
          onChange={onChange}
        />
      )}
    </VStack>
  );
}

/**
 * The individual actions, for the role that genuinely needs "create but never
 * delete".
 *
 * An action that full access already covers is shown as held, and clicking it
 * withdraws the full access that implies it rather than pretending the two are
 * independent.
 */
function ResourceActions({
  resource,
  selected,
  onChange,
}: {
  resource: Resource;
  selected: AuthzPermission[];
  onChange: (next: AuthzPermission[]) => void;
}) {
  const actions = offeredActions(resource);
  const managePermission = `${resource}:manage` as AuthzPermission;
  const hasFullAccess =
    actions.includes("manage") && selected.includes(managePermission);

  return (
    <VStack align="start" gap={2} paddingTop={1}>
      {actions.map((action) => {
        const permission = `${resource}:${action}` as AuthzPermission;
        const impliedByFullAccess = action !== "manage" && hasFullAccess;
        const target = impliedByFullAccess ? managePermission : permission;
        const held = selected.includes(permission) || impliedByFullAccess;
        const actionWords = actionCopy(action);

        return (
          <Checkbox
            key={permission}
            checked={held}
            onChange={() =>
              onChange(
                held
                  ? withoutDependents({
                      resource,
                      permission: target,
                      selected,
                    })
                  : withDependencies({
                      resource,
                      permission: target,
                      selected,
                    }),
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
