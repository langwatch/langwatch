import {
  Box,
  Button,
  createListCollection,
  HStack,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react";
import { Building2, CheckCheck, Folder, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Select } from "../ui/select";
import { SmallLabel } from "../SmallLabel";
import { ProviderScopeChips } from "./ProviderScopeChips";

export type ScopeChipPickerScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

export interface ScopeChipPickerEntry {
  scopeType: ScopeChipPickerScopeType;
  scopeId: string;
}

interface ScopeOption {
  value: string;
  label: string;
  scopeType: ScopeChipPickerScopeType;
  scopeId: string;
}

const SCOPE_DESCRIPTION_SINGLE: Record<ScopeChipPickerScopeType, string> = {
  PROJECT: "Only this project can use this configuration.",
  TEAM: "Every project in the team inherits this configuration.",
  ORGANIZATION: "Every project in the organization inherits this configuration.",
};

function summariseSelection(scopes: ScopeChipPickerEntry[]): string {
  if (scopes.length === 0) {
    return "Pick at least one scope.";
  }
  if (scopes.length === 1) {
    return SCOPE_DESCRIPTION_SINGLE[scopes[0]!.scopeType];
  }
  const counts = scopes.reduce(
    (acc, s) => {
      acc[s.scopeType] = (acc[s.scopeType] ?? 0) + 1;
      return acc;
    },
    {} as Record<ScopeChipPickerScopeType, number>,
  );
  const parts: string[] = [];
  if (counts.ORGANIZATION) parts.push("the organization");
  if (counts.TEAM)
    parts.push(counts.TEAM === 1 ? "1 team" : `${counts.TEAM} teams`);
  if (counts.PROJECT)
    parts.push(
      counts.PROJECT === 1 ? "1 project" : `${counts.PROJECT} projects`,
    );
  return `Shared across ${parts.join(" + ")}.`;
}

const ScopeIcon = ({ scopeType }: { scopeType: ScopeChipPickerScopeType }) => {
  if (scopeType === "ORGANIZATION") return <Building2 size={16} aria-hidden />;
  if (scopeType === "TEAM") return <Users size={16} aria-hidden />;
  return <Folder size={16} aria-hidden />;
};

/**
 * Collapses redundant selections after the user picks a new scope.
 *
 * Rules (lineage-only, never touches scopes outside the picked one's
 * branch — so cross-team selections survive):
 *
 *   - Picking an ORGANIZATION drops every TEAM and PROJECT that lives
 *     under it. The org-level row already covers them; keeping both
 *     would render two chips with one effective grant.
 *   - Picking a TEAM drops the parent organization AND every PROJECT
 *     under that team. The narrower team scope is the user's intent.
 *   - Picking a PROJECT drops the parent organization AND the parent
 *     team (if either is selected). Same intent narrowing — without
 *     this an "Org X + Project P" pair silently means "everyone in X
 *     including P", which is the trip-up the user flagged.
 *
 * Pure function so it stays trivially unit-testable. Exported for
 * tests.
 */
export function collapseRedundantScopes(
  next: ScopeChipPickerEntry[],
  prev: ScopeChipPickerEntry[],
  context: {
    organizationId: string | undefined;
    availableProjects: Array<{ id: string; teamId?: string }>;
  },
): ScopeChipPickerEntry[] {
  const prevKey = new Set(prev.map((s) => `${s.scopeType}:${s.scopeId}`));
  const added = next.filter(
    (s) => !prevKey.has(`${s.scopeType}:${s.scopeId}`),
  );
  if (added.length === 0) return next;

  const { organizationId, availableProjects } = context;
  let cleaned = next;
  for (const picked of added) {
    if (picked.scopeType === "ORGANIZATION") {
      // The picker is single-org-scoped, so every team and project in
      // `next` belongs to this org by construction. Dropping them
      // collapses to the single ORG chip.
      cleaned = cleaned.filter(
        (s) =>
          !(
            (s.scopeType === "TEAM" || s.scopeType === "PROJECT") &&
            // Defensive guard: only collapse children that belong to
            // the picked org. With multi-org pickers this gates the
            // collapse to the lineage.
            (organizationId === undefined ||
              picked.scopeId === organizationId)
          ),
      );
    } else if (picked.scopeType === "TEAM") {
      cleaned = cleaned.filter((s) => {
        // Parent org goes — team narrows the scope.
        if (
          s.scopeType === "ORGANIZATION" &&
          organizationId !== undefined &&
          s.scopeId === organizationId
        ) {
          return false;
        }
        // Projects under this team are redundant once the team is
        // covered explicitly.
        if (s.scopeType === "PROJECT") {
          const proj = availableProjects.find((p) => p.id === s.scopeId);
          if (proj?.teamId === picked.scopeId) return false;
        }
        return true;
      });
    } else if (picked.scopeType === "PROJECT") {
      const parentTeamId = availableProjects.find(
        (p) => p.id === picked.scopeId,
      )?.teamId;
      cleaned = cleaned.filter((s) => {
        if (
          s.scopeType === "ORGANIZATION" &&
          organizationId !== undefined &&
          s.scopeId === organizationId
        ) {
          return false;
        }
        if (
          s.scopeType === "TEAM" &&
          parentTeamId !== undefined &&
          s.scopeId === parentTeamId
        ) {
          return false;
        }
        return true;
      });
    }
  }
  return cleaned;
}

/**
 * Controlled chip-based scope picker. Pure presentation: takes the active
 * scope selection and a setter, renders a grouped multi-select over the
 * organization, the teams the caller can reach, and the projects inside
 * those teams. Selected entries render as removable chips above the field.
 *
 * Extracted from the model-provider create-drawer so the role-based default
 * model lines, gateway provider bindings, and any future "pick scopes here"
 * surface can render the same primitive without inheriting the drawer's
 * form-state machinery.
 */
export function ScopeChipPicker({
  value,
  onChange,
  organizationId,
  organizationName,
  teamId,
  teamName,
  projectId,
  projectName,
  availableTeams,
  availableProjects,
  label = "Scope",
  showSummary = true,
  showQuickPicks = false,
  singleSelect = false,
  currentOrganizationId,
  currentTeamId,
  currentProjectId,
}: {
  value: ScopeChipPickerEntry[];
  onChange: (next: ScopeChipPickerEntry[]) => void;
  organizationId: string | undefined;
  organizationName?: string;
  teamId?: string | undefined;
  teamName?: string;
  projectId?: string;
  projectName?: string;
  /** Teams the caller can pick. Falls back to `[{id:teamId, name:teamName}]`. */
  availableTeams?: Array<{ id: string; name: string }>;
  /** Projects the caller can pick. Falls back to `[{id:projectId, name:projectName}]`. */
  availableProjects?: Array<{ id: string; name: string; teamId?: string }>;
  /** Override the field label. Defaults to "Scope". */
  label?: string;
  /** When false, hides the helper "Shared across …" line below the field. */
  showSummary?: boolean;
  /** Single-scope mode: a row may live at exactly one scope (inline
   *  (scopeType, scopeId) resources like model costs / budgets). Renders the
   *  org/team/project quick-pick chips as a single-select, drops the
   *  "Multiple" chip and the multi-select dropdown entirely. `value` is still
   *  an array but holds at most one entry. */
  singleSelect?: boolean;
  /** When true, render the Organization/Team/Project quick-pick chip
   *  row above the field and collapse the multi-select dropdown by
   *  default. Clicking the 4th "Multiple" chip (CheckCheck icon)
   *  reveals the dropdown for fine-grained selection. The 99% case is
   *  one scope; this keeps the picker quiet for that case and the
   *  rare multi-scope policies stay one click away. */
  showQuickPicks?: boolean;
  /** Current org/team/project IDs that drive the quick-pick chips.
   *  Independent from `organizationId/teamId/projectId` (which feed
   *  the dropdown options) so the quick-picks always pin to the
   *  user's working context even when the dropdown lists more. */
  currentOrganizationId?: string | null;
  currentTeamId?: string | null;
  currentProjectId?: string | null;
}) {
  const options = useMemo<ScopeOption[]>(() => {
    const out: ScopeOption[] = [];
    if (organizationId) {
      out.push({
        value: `ORGANIZATION:${organizationId}`,
        label: organizationName ?? "Organization",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      });
    }
    const teams =
      availableTeams && availableTeams.length > 0
        ? availableTeams
        : teamId
          ? [{ id: teamId, name: teamName ?? "Team" }]
          : [];
    for (const team of teams) {
      out.push({
        value: `TEAM:${team.id}`,
        label: team.name,
        scopeType: "TEAM",
        scopeId: team.id,
      });
    }
    const projects =
      availableProjects && availableProjects.length > 0
        ? availableProjects
        : projectId
          ? [{ id: projectId, name: projectName ?? "Project" }]
          : [];
    for (const project of projects) {
      out.push({
        value: `PROJECT:${project.id}`,
        label: project.name,
        scopeType: "PROJECT",
        scopeId: project.id,
      });
    }
    return out;
  }, [
    organizationId,
    organizationName,
    teamId,
    teamName,
    projectId,
    projectName,
    availableTeams,
    availableProjects,
  ]);

  const collection = useMemo(
    () => createListCollection({ items: options }),
    [options],
  );

  const selectedValues = useMemo(
    () => value.map((s) => `${s.scopeType}:${s.scopeId}`),
    [value],
  );

  // Quick-pick row + collapsible-multi mode. See `showQuickPicks` prop.
  const quickPicks = useMemo(() => {
    const out: Array<{
      key: "ORGANIZATION" | "TEAM" | "PROJECT";
      label: string;
      icon: React.ReactElement;
      scope: ScopeChipPickerEntry;
    }> = [];
    if (currentOrganizationId) {
      out.push({
        key: "ORGANIZATION",
        label: "Organization",
        icon: <Building2 size={14} aria-hidden />,
        scope: { scopeType: "ORGANIZATION", scopeId: currentOrganizationId },
      });
    }
    if (currentTeamId) {
      out.push({
        key: "TEAM",
        label: "This team",
        icon: <Users size={14} aria-hidden />,
        scope: { scopeType: "TEAM", scopeId: currentTeamId },
      });
    }
    if (currentProjectId) {
      out.push({
        key: "PROJECT",
        label: "This project",
        icon: <Folder size={14} aria-hidden />,
        scope: { scopeType: "PROJECT", scopeId: currentProjectId },
      });
    }
    return out;
  }, [currentOrganizationId, currentTeamId, currentProjectId]);

  const matchingQuickPick = useMemo(() => {
    if (value.length !== 1) return null;
    const s = value[0]!;
    return (
      quickPicks.find(
        (qp) =>
          qp.scope.scopeType === s.scopeType && qp.scope.scopeId === s.scopeId,
      ) ?? null
    );
  }, [value, quickPicks]);

  // `multipleMode` is local UI state: when true the dropdown is
  // visible and the "Multiple" chip is highlighted. Derived from the
  // current selection on mount; afterwards it only auto-FLIPS-ON (when
  // an external selection change creates a multi-scope state) and
  // NEVER auto-flips-off. The reverse direction would collapse the
  // dropdown mid-edit — e.g. a user in Multiple mode who deselects
  // one of two scopes transiently has a single-quick-pick value, and
  // collapsing the dropdown before they pick the second team is the
  // exact UX paper-cut that surfaced on 2026-05-18. Quick-pick chip
  // clicks are the only path that turns multipleMode off.
  const derivedMultiple = !matchingQuickPick;
  const [multipleMode, setMultipleMode] = useState(derivedMultiple);
  useEffect(() => {
    if (derivedMultiple) setMultipleMode(true);
  }, [derivedMultiple]);

  const dropdownVisible = singleSelect ? false : !showQuickPicks || multipleMode;

  return (
    <VStack align="start" width="full" gap={1.5}>
      {label && <SmallLabel>{label}</SmallLabel>}
      {(showQuickPicks || singleSelect) && quickPicks.length > 0 && (
        <Wrap gap={2} role="group" aria-label="Quick scope">
          {quickPicks.map((pick) => {
            const active = matchingQuickPick?.key === pick.key && !multipleMode;
            return (
              <Button
                key={`${pick.scope.scopeType}:${pick.scope.scopeId}`}
                type="button"
                size="xs"
                variant={active ? "solid" : "outline"}
                aria-pressed={active}
                onClick={() => {
                  setMultipleMode(false);
                  onChange([pick.scope]);
                }}
                data-testid={`quick-scope-${pick.scope.scopeType.toLowerCase()}`}
              >
                <HStack gap={1}>
                  {pick.icon}
                  <Text>{pick.label}</Text>
                </HStack>
              </Button>
            );
          })}
          {/* 4th chip — collapses to the same fast path for the 99%
              one-scope case but exposes the multi-select dropdown for
              the long tail (one policy attached to N projects /
              cross-team rules). Active whenever the current selection
              doesn't reduce to a single quick-pick scope. Hidden in
              single-scope mode, where multi-scope is not representable. */}
          {!singleSelect && (
            <Button
              type="button"
              size="xs"
              variant={multipleMode ? "solid" : "outline"}
              aria-pressed={multipleMode}
              onClick={() => setMultipleMode(true)}
              data-testid="quick-scope-multiple"
            >
              <HStack gap={1}>
                <CheckCheck size={14} aria-hidden />
                <Text>Multiple</Text>
              </HStack>
            </Button>
          )}
        </Wrap>
      )}
      {dropdownVisible && (
      <Select.Root
        collection={collection}
        value={selectedValues}
        multiple
        onValueChange={(details) => {
          const picked = new Set(details.value);
          const next = options
            .filter((o) => picked.has(o.value))
            .map((o) => ({ scopeType: o.scopeType, scopeId: o.scopeId }));
          onChange(
            collapseRedundantScopes(next, value, {
              organizationId,
              availableProjects:
                availableProjects && availableProjects.length > 0
                  ? availableProjects
                  : projectId
                    ? [{ id: projectId, name: projectName ?? "Project" }]
                    : [],
            }),
          );
        }}
      >
        <Select.Trigger>
          <Select.ValueText placeholder="Pick one or more scopes">
            {() => {
              if (value.length === 0) return "Pick one or more scopes";
              // Hydrate the chips with names looked up from the picker's
              // `options` so each chip reads "LangWatch" / "Acme Team" /
              // "web-app" instead of bare "Organization" / "Team" /
              // "Project". Without this, multiple teams render as
              // identical "Team", "Team" pills — the bug rchaves caught
              // in the model-provider drawer screenshot.
              const named = value.map((v) => {
                const match = options.find(
                  (o) =>
                    o.scopeType === v.scopeType && o.scopeId === v.scopeId,
                );
                return {
                  scopeType: v.scopeType,
                  scopeId: v.scopeId,
                  name: match?.label,
                };
              });
              return <ProviderScopeChips scopes={named} />;
            }}
          </Select.ValueText>
        </Select.Trigger>
        <Select.Content>
          {options.some((o) => o.scopeType === "ORGANIZATION") && (
            <Select.ItemGroup label="Organization">
              {options
                .filter((o) => o.scopeType === "ORGANIZATION")
                .map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="ORGANIZATION" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
            </Select.ItemGroup>
          )}
          {options.some((o) => o.scopeType === "TEAM") && (
            <Select.ItemGroup label="Teams">
              {options
                .filter((o) => o.scopeType === "TEAM")
                .map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="TEAM" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
            </Select.ItemGroup>
          )}
          {options.some((o) => o.scopeType === "PROJECT") && (
            <Select.ItemGroup label="Projects">
              {options
                .filter((o) => o.scopeType === "PROJECT")
                .map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="PROJECT" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
            </Select.ItemGroup>
          )}
        </Select.Content>
      </Select.Root>
      )}
      {showSummary && (
        <Box>
          <Text fontSize="xs" color="gray.600">
            {summariseSelection(value)}
          </Text>
        </Box>
      )}
    </VStack>
  );
}
