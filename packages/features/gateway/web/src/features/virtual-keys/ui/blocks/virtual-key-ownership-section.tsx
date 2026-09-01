import { Badge, Button, HStack, Text, VStack, Wrap } from "@chakra-ui/react";
import { Building2, Folder, UserLock, Users } from "lucide-react";
import { useMemo } from "react";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { SmallLabel } from "@langwatch/design-system/small-label";
import { ProviderScopeChips } from "@langwatch/authz-web/surfaces/scope-picker";
import { ScopeChipPicker, type ScopeTriadEntry } from "@langwatch/authz-web/surfaces/scope-picker";
import { ViewTracesButton } from "../elements/view-traces-button";

/**
 * Where a virtual key lives: who can see and manage it, and where its
 * traces and costs land. This replaces the old abstract "scope" picker
 * with the four shapes a key actually takes.
 */
export type VirtualKeyOwnershipKind = "PROJECT" | "PERSONAL" | "TEAM" | "ORGANIZATION";

export type VirtualKeyOwnership = {
  kind: VirtualKeyOwnershipKind;
  /** PROJECT ownership: the owning project. */
  projectId: string | null;
  /** TEAM ownership: the owning team. */
  teamId: string | null;
  /**
   * ORGANIZATION / TEAM ownership: the project this key's traces and
   * costs land in. Required: a key whose traces land nowhere accrues
   * against no budget, so the server refuses it.
   */
  traceProjectId: string | null;
};

export type OwnershipContext = {
  organizationId: string;
  organizationName?: string;
  availableTeams: Array<{ id: string; name: string }>;
  availableProjects: Array<{ id: string; name: string; teamId?: string }>;
  /** The caller's personal workspace project, once resolved. */
  personalProjectId: string | null;
};

/**
 * The scope rows a chosen ownership persists as, or null while the choice
 * is incomplete (e.g. org ownership with no trace project picked yet).
 * The scopes are ACCESS rows only: an org- or team-owned key's trace
 * destination rides `traceProjectId` (see `ownershipTraceProjectId`),
 * never a scope row, because scope rows grant visibility and operate
 * rights and the trace destination must grant neither.
 */
export function ownershipToScopes(
  value: VirtualKeyOwnership,
  ctx: Pick<OwnershipContext, "organizationId" | "personalProjectId">,
): ScopeTriadEntry[] | null {
  switch (value.kind) {
    case "PROJECT":
      return value.projectId
        ? [{ scopeType: "PROJECT", scopeId: value.projectId }]
        : null;
    case "PERSONAL":
      return ctx.personalProjectId
        ? [{ scopeType: "PROJECT", scopeId: ctx.personalProjectId }]
        : null;
    case "TEAM":
      return value.teamId && value.traceProjectId
        ? [{ scopeType: "TEAM", scopeId: value.teamId }]
        : null;
    case "ORGANIZATION":
      return value.traceProjectId
        ? [{ scopeType: "ORGANIZATION", scopeId: ctx.organizationId }]
        : null;
  }
}

/**
 * The explicit trace destination the ownership carries, when it is a
 * separate decision from the access scope. Project- and personal-owned
 * keys return null: their single PROJECT access scope IS the
 * destination, and duplicating it would create a value that can drift.
 */
export function ownershipTraceProjectId(value: VirtualKeyOwnership): string | null {
  switch (value.kind) {
    case "PROJECT":
    case "PERSONAL":
      return null;
    case "TEAM":
    case "ORGANIZATION":
      return value.traceProjectId;
  }
}

/** Why the current ownership cannot be saved yet, or null when it can. */
export function ownershipIncompleteReason(
  value: VirtualKeyOwnership,
  ctx: Pick<OwnershipContext, "personalProjectId">,
): string | null {
  switch (value.kind) {
    case "PROJECT":
      return value.projectId ? null : "Pick the project this key belongs to.";
    case "PERSONAL":
      return ctx.personalProjectId ? null : "Resolving your personal workspace…";
    case "TEAM":
      if (!value.teamId) return "Pick the team this key belongs to.";
      return value.traceProjectId
        ? null
        : "Pick the project where traces and costs land.";
    case "ORGANIZATION":
      return value.traceProjectId
        ? null
        : "Pick the project where traces and costs land.";
  }
}

function projectName(
  projectId: string | null,
  ctx: Pick<OwnershipContext, "availableProjects">,
): string | null {
  if (!projectId) return null;
  const p = ctx.availableProjects.find((p) => p.id === projectId);
  if (!p) return null;
  return p.name.split(" · ")[0] ?? p.name;
}

const KIND_OPTIONS: Array<{
  kind: VirtualKeyOwnershipKind;
  label: string;
  icon: React.ReactElement;
}> = [
  { kind: "PROJECT", label: "Project", icon: <Folder size={14} aria-hidden /> },
  {
    kind: "PERSONAL",
    label: "Personal",
    icon: <UserLock size={14} aria-hidden />,
  },
  { kind: "TEAM", label: "Team", icon: <Users size={14} aria-hidden /> },
  {
    kind: "ORGANIZATION",
    label: "Organization",
    icon: <Building2 size={14} aria-hidden />,
  },
];

/**
 * Ownership picker for the virtual-key drawers. Project (default) and
 * Personal are open to everyone; Team and Organization only appear for
 * roles that may create shared keys (`canCreateShared`).
 *
 * The consequence of the choice is stated inline: every ownership names
 * the project its traces and costs land in, because that is the feed
 * every budget accrues from; there is no untraced shape.
 */
export function VirtualKeyOwnershipSection({
  value,
  onChange,
  ctx,
  canCreateShared,
}: {
  value: VirtualKeyOwnership;
  onChange: (next: VirtualKeyOwnership) => void;
  ctx: OwnershipContext;
  canCreateShared: boolean;
}) {
  const kinds = useMemo(
    () =>
      KIND_OPTIONS.filter(
        (o) => canCreateShared || o.kind === "PROJECT" || o.kind === "PERSONAL",
      ),
    [canCreateShared],
  );

  const projectPicker = (
    label: string,
    picked: string | null,
    write: (projectId: string | null) => void,
  ) => (
    <VStack align="start" width="full" gap={1}>
      <ScopeChipPicker
        value={picked ? [{ scopeType: "PROJECT" as const, scopeId: picked }] : []}
        onChange={(next) => write(next[0]?.scopeId ?? null)}
        organizationId={ctx.organizationId}
        organizationName={ctx.organizationName}
        availableTeams={ctx.availableTeams}
        availableProjects={ctx.availableProjects}
        allowedScopeTypes={["PROJECT"]}
        variant="single-select"
        label={label}
        placeholder="Select a project"
        showSummary={false}
      />
    </VStack>
  );

  const landsIn = (name: string | null) =>
    name && (
      <Text fontSize="xs" color="fg.muted" data-testid="vk-trace-destination">
        Traces and costs land in {name}.
      </Text>
    );

  return (
    <VStack align="start" width="full" gap={1.5}>
      <HStack gap={1} alignItems="center">
        <SmallLabel>Ownership</SmallLabel>
        <FieldInfoTooltip
          description="Who can see and manage this key, and where its traces and costs land. Project keys belong to one project; personal keys live in your own workspace; team and organization keys are shared with everyone in that team or organization."
          docHref="/ai-gateway/virtual-keys#creating-a-vk"
          testId="vk-ownership-info"
        />
      </HStack>
      <Wrap gap={2} role="group" aria-label="Ownership">
        {kinds.map((o) => {
          const active = value.kind === o.kind;
          return (
            <Button
              key={o.kind}
              type="button"
              size="xs"
              variant={active ? "solid" : "outline"}
              aria-pressed={active}
              onClick={() => onChange({ ...value, kind: o.kind })}
              data-testid={`vk-ownership-${o.kind.toLowerCase()}`}
            >
              <HStack gap={1}>
                {o.icon}
                <Text>{o.label}</Text>
              </HStack>
            </Button>
          );
        })}
      </Wrap>

      {value.kind === "PROJECT" && (
        <>
          {ctx.availableProjects.length > 1 &&
            projectPicker("", value.projectId, (projectId) =>
              onChange({ ...value, projectId }),
            )}
          {landsIn(projectName(value.projectId, ctx))}
        </>
      )}

      {value.kind === "PERSONAL" && (
        <Text fontSize="xs" color="fg.muted" data-testid="vk-trace-destination">
          Only you can use this key. Traces and costs land in your personal workspace.
        </Text>
      )}

      {value.kind === "TEAM" && (
        <>
          {ctx.availableTeams.length > 1 && (
            <ScopeChipPicker
              value={
                value.teamId
                  ? [{ scopeType: "TEAM" as const, scopeId: value.teamId }]
                  : []
              }
              onChange={(next) =>
                onChange({ ...value, teamId: next[0]?.scopeId ?? null })
              }
              organizationId={ctx.organizationId}
              organizationName={ctx.organizationName}
              availableTeams={ctx.availableTeams}
              availableProjects={[]}
              allowedScopeTypes={["TEAM"]}
              variant="single-select"
              label=""
              placeholder="Select a team"
              showSummary={false}
            />
          )}
          {projectPicker(
            "Traces and costs land in",
            value.traceProjectId,
            (traceProjectId) => onChange({ ...value, traceProjectId }),
          )}
        </>
      )}

      {value.kind === "ORGANIZATION" &&
        projectPicker(
          "Traces and costs land in",
          value.traceProjectId,
          (traceProjectId) => onChange({ ...value, traceProjectId }),
        )}
    </VStack>
  );
}

/**
 * Read-only ownership for the edit drawer: the scope chips the key
 * already has, plus where its traces land.
 *
 * The destination is the one stored on the key, not one re-derived from the
 * scopes, so what is shown here is what the gateway actually does. A key
 * whose destination was deleted keeps sending its traces there, which is the
 * one thing a reader cannot tell from anything else on the row, so it is
 * badged.
 */
export function VirtualKeyOwnershipReadOnly({
  scopes,
  principal,
  traceProjectId,
  traceProjectArchived,
  viewTracesHref,
  ctx,
}: {
  scopes: Array<{
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>;
  principal?: { name?: string | null; email?: string | null };
  /** The key's stored destination. Null only for keys that predate it. */
  traceProjectId: string | null;
  traceProjectArchived: boolean;
  /**
   * Where the destination's traces can be read, when the caller resolved a
   * project the viewer may open. Left off for a destination that is deleted
   * or outside the viewer's teams.
   */
  viewTracesHref?: string;
  ctx: Pick<
    OwnershipContext,
    "organizationName" | "availableTeams" | "availableProjects"
  >;
}) {
  const named = scopes.map((s) => ({
    scopeType: s.scopeType,
    scopeId: s.scopeId,
    name:
      s.scopeType === "ORGANIZATION"
        ? ctx.organizationName
        : s.scopeType === "TEAM"
          ? ctx.availableTeams.find((t) => t.id === s.scopeId)?.name
          : (projectName(s.scopeId, ctx) ?? undefined),
  }));
  // A deleted project is not in the picker's list, so its name does not
  // resolve; the badge next to it is what carries the meaning either way.
  const destination = traceProjectId
    ? (projectName(traceProjectId, ctx) ??
      (traceProjectArchived ? "a deleted project" : traceProjectId))
    : null;

  return (
    <VStack align="start" width="full" gap={1.5}>
      <HStack gap={1} alignItems="center">
        <SmallLabel>Ownership</SmallLabel>
        <FieldInfoTooltip
          description="Scopes control who can see and manage this key. The trace destination is stored on the key, so changing scopes never moves where traces and costs land. Move either through the management API, or revoke this key and create a new one."
          docHref="/ai-gateway/virtual-keys#creating-a-vk"
          testId="vk-ownership-info"
        />
      </HStack>
      <ProviderScopeChips scopes={named} principal={principal} />
      <HStack gap={1.5} alignItems="center">
        <Text fontSize="xs" color="fg.muted" data-testid="vk-trace-destination">
          {destination ? (
            <>Traces and costs land in {destination}.</>
          ) : (
            <>
              This key has no trace destination, so its traces and costs are not filed
              into any project. Give it a trace project through the management API.
            </>
          )}
        </Text>
        {traceProjectArchived && (
          <Badge
            size="sm"
            colorPalette="orange"
            variant="subtle"
            data-testid="vk-trace-destination-deleted"
          >
            Deleted
          </Badge>
        )}
        {viewTracesHref && !traceProjectArchived && (
          <ViewTracesButton href={viewTracesHref} />
        )}
      </HStack>
      {traceProjectArchived && (
        <Text fontSize="xs" color="fg.muted">
          This key keeps sending its traces and costs there. Restore the project to see
          them again, or point the key at another project through the management API.
        </Text>
      )}
    </VStack>
  );
}
