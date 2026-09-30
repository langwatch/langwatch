import {
  Box,
  Button,
  createListCollection,
  HStack,
  Input,
  type ListCollection,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react";
import { Select } from "@langwatch/design-system/select";
import { SmallLabel } from "@langwatch/design-system/small-label";
import { Boxes, Building2, CheckCheck, Folder, Search, UserLock, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ProviderScopeChips } from "./provider-scope-chips.tsx";

/**
 * ORGANIZATION/TEAM/PROJECT mirror Prisma's `ModelProviderScopeType`.
 * DEPARTMENT is picker-only via `allowedScopeTypes`: the tile catalog
 * offers ORGANIZATION + DEPARTMENT, model providers keep ORGANIZATION/TEAM/PROJECT.
 */
export type ScopeChipPickerScopeType = "ORGANIZATION" | "TEAM" | "PROJECT" | "DEPARTMENT";

/**
 * The model-provider triad, mapping 1:1 to Prisma's `ModelProviderScopeType`
 * enum, so DEPARTMENT can never leak into a scoped-resource DB write.
 */
export type ScopeTriadType = "ORGANIZATION" | "TEAM" | "PROJECT";

/** Default offering: the model-provider triad. Consumers that want the
 *  department cut pass `allowedScopeTypes` explicitly. */
export const DEFAULT_SCOPE_TYPES: ScopeTriadType[] = ["ORGANIZATION", "TEAM", "PROJECT"];

/** A scope selection over the full picker union (includes DEPARTMENT). The
 *  tile catalog uses this; triad consumers use `ScopeTriadEntry`. */
export interface ScopeChipPickerEntry {
  scopeType: ScopeChipPickerScopeType;
  scopeId: string;
  /** Personal-projects variant of the scope (opt-in via `personalScopes`):
   *  ORGANIZATION+personalOnly = every personal workspace in the org,
   *  DEPARTMENT+personalOnly = the personal workspaces of that department's
   *  members. Distinct from the plain scope - both can carry their own rule. */
  personalOnly?: boolean;
}

/** Selection identity: the personal variant of a scope is a different target
 *  than the plain scope, so it gets its own key. */
function entryKey(entry: {
  scopeType: ScopeChipPickerScopeType;
  scopeId: string;
  personalOnly?: boolean;
}): string {
  return entry.personalOnly
    ? `${entry.scopeType}:${entry.scopeId}:personal`
    : `${entry.scopeType}:${entry.scopeId}`;
}

/** A scope selection constrained to the model-provider triad. Resource
 *  consumers (model providers, VKs, budgets, routing policies, default models,
 *  retention) use this so DEPARTMENT can never leak into a scoped-resource
 *  write. The generic `ScopeChipPicker` returns the same element type the
 *  caller's `value` carries, so passing `ScopeTriadEntry[]` keeps it narrow. */
export interface ScopeTriadEntry {
  scopeType: ScopeTriadType;
  scopeId: string;
}

interface ScopeOption {
  value: string;
  label: string;
  scopeType: ScopeChipPickerScopeType;
  scopeId: string;
  personalOnly?: boolean;
}

function describeSingleScope({
  scopeType,
  subjectNoun,
}: {
  scopeType: ScopeChipPickerScopeType;
  subjectNoun: string;
}): string {
  switch (scopeType) {
    case "PROJECT":
      return `Only this project can use this ${subjectNoun}.`;
    case "TEAM":
      return `Every project in the team inherits this ${subjectNoun}.`;
    case "ORGANIZATION":
      return `Every project in the organization inherits this ${subjectNoun}.`;
    case "DEPARTMENT":
      return `Every member of this department can use this ${subjectNoun}.`;
    default: {
      const exhaustive: never = scopeType;
      return exhaustive;
    }
  }
}

function summariseSelection({
  scopes,
  subjectNoun,
}: {
  scopes: ScopeChipPickerEntry[];
  subjectNoun: string;
}): string {
  if (scopes.length === 0) {
    return "Pick at least one scope.";
  }
  if (scopes.length === 1) {
    const only = scopes[0]!;
    if (only.personalOnly) {
      return only.scopeType === "ORGANIZATION"
        ? `Every personal workspace in the organization inherits this ${subjectNoun}.`
        : `The personal workspaces of this department's members inherit this ${subjectNoun}.`;
    }
    return describeSingleScope({ scopeType: only.scopeType, subjectNoun });
  }
  const personal = scopes.filter((s) => s.personalOnly);
  const plain = scopes.filter((s) => !s.personalOnly);
  const counts = plain.reduce(
    (acc, s) => {
      acc[s.scopeType] = (acc[s.scopeType] ?? 0) + 1;
      return acc;
    },
    {} as Record<ScopeChipPickerScopeType, number>,
  );
  const parts: string[] = [];
  if (counts.ORGANIZATION) parts.push("the organization");
  if (counts.DEPARTMENT)
    parts.push(counts.DEPARTMENT === 1 ? "1 department" : `${counts.DEPARTMENT} departments`);
  if (counts.TEAM) parts.push(counts.TEAM === 1 ? "1 team" : `${counts.TEAM} teams`);
  if (counts.PROJECT) parts.push(counts.PROJECT === 1 ? "1 project" : `${counts.PROJECT} projects`);
  if (personal.some((s) => s.scopeType === "ORGANIZATION")) {
    parts.push("all personal projects");
  }
  const personalDepartments = personal.filter((s) => s.scopeType === "DEPARTMENT").length;
  if (personalDepartments > 0) {
    parts.push(
      personalDepartments === 1
        ? "1 department's personal projects"
        : `${personalDepartments} departments' personal projects`,
    );
  }
  return `Shared across ${parts.join(" + ")}.`;
}

const ScopeIcon = ({ scopeType }: { scopeType: ScopeChipPickerScopeType }) => {
  if (scopeType === "ORGANIZATION") return <Building2 size={16} aria-hidden />;
  if (scopeType === "TEAM") return <Users size={16} aria-hidden />;
  if (scopeType === "DEPARTMENT") return <Boxes size={16} aria-hidden />;
  return <Folder size={16} aria-hidden />;
};

/**
 * Above this many options the dropdown gains a search field: a scope
 * list that long no longer reads at a glance, so finding beats reading.
 */
const SCOPE_SEARCH_THRESHOLD = 8;

/**
 * The search field pinned to the top of a long scope dropdown.
 *
 * Spec: specs/components/scope-chip-picker-search.feature
 */
function ScopeSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Box
      position="sticky"
      top={0}
      zIndex={1}
      background="bg.panel"
      paddingX={2.5}
      paddingY={1.5}
      borderBottomWidth="1px"
      borderColor="border"
    >
      <HStack gap={2} color="fg.muted">
        <Search size={14} aria-hidden />
        <Input
          placeholder="Search scopes"
          aria-label="Search scopes"
          size="sm"
          height="28px"
          minWidth={0}
          flex={1}
          padding={0}
          border={0}
          outline="none"
          background="transparent"
          color="fg"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          _placeholder={{ color: "fg.subtle" }}
          _focusVisible={{ outline: "none" }}
        />
      </HStack>
    </Box>
  );
}

/**
 * Groups PROJECT options under their parent team. A project whose team
 * the caller did not list falls into a flat "Projects" group, same as
 * when the caller passes no team data at all.
 */
function groupProjectOptions({
  projectOptions,
  availableTeams,
  availableProjects,
}: {
  projectOptions: ScopeOption[];
  availableTeams: { id: string; name: string }[] | undefined;
  availableProjects: { id: string; teamId?: string }[] | undefined;
}): {
  teamGroups: {
    teamId: string;
    teamName: string;
    projects: ScopeOption[];
  }[];
  orphanProjects: ScopeOption[];
} {
  const teamNameById = new Map((availableTeams ?? []).map((t) => [t.id, t.name] as const));
  const teamIdByProjectId = new Map(
    (availableProjects ?? []).map((p) => [p.id, p.teamId] as const),
  );
  const projectsByTeam = new Map<string, ScopeOption[]>();
  const orphanProjects: ScopeOption[] = [];
  for (const option of projectOptions) {
    const teamId = teamIdByProjectId.get(option.scopeId);
    if (teamId && teamNameById.has(teamId)) {
      const bucket = projectsByTeam.get(teamId) ?? [];
      bucket.push(option);
      projectsByTeam.set(teamId, bucket);
    } else {
      orphanProjects.push(option);
    }
  }
  const teamGroups = Array.from(projectsByTeam.entries())
    .map(([teamId, projects]) => ({
      teamId,
      teamName: teamNameById.get(teamId) ?? "Team",
      projects,
    }))
    .toSorted((a, b) => a.teamName.localeCompare(b.teamName));
  return { teamGroups, orphanProjects };
}

function listedOrCurrent<E extends { id: string; name: string }>({
  listed,
  currentId,
  currentName,
}: {
  listed: E[] | undefined;
  currentId: string | undefined;
  currentName: string;
}): (E | { id: string; name: string })[] {
  if (listed && listed.length > 0) return listed;
  if (currentId) return [{ id: currentId, name: currentName }];
  return [];
}

// Collapse redundant scopes per lineage; org/dept mutually exclusive.
export function collapseRedundantScopes(
  next: ScopeChipPickerEntry[],
  prev: ScopeChipPickerEntry[],
  context: {
    organizationId: string | undefined;
    availableProjects: { id: string; teamId?: string }[];
  },
): ScopeChipPickerEntry[] {
  const prevKey = new Set(prev.map(entryKey));
  const added = next.filter((s) => !prevKey.has(entryKey(s)));
  if (added.length === 0) return next;

  return added.reduce(
    (cleaned, picked) => collapseForPick({ entries: cleaned, picked, context }),
    next,
  );
}

type CollapseContext = {
  organizationId: string | undefined;
  availableProjects: { id: string; teamId?: string }[];
};

/** The plain org-wide pick for this picker's organization. */
function isOrganizationWide(entry: ScopeChipPickerEntry, organizationId: string | undefined) {
  return (
    entry.scopeType === "ORGANIZATION" &&
    !entry.personalOnly &&
    organizationId !== undefined &&
    entry.scopeId === organizationId
  );
}

/**
 * The picker is single-org-scoped, so every team and project belongs to this org: an org-wide
 * pick drops them, every department and every personal variant, collapsing to the one ORG chip.
 */
function keptBesideOrganization(
  entry: ScopeChipPickerEntry,
  picked: ScopeChipPickerEntry,
  organizationId: string | undefined,
): boolean {
  if (entry.personalOnly || entry.scopeType === "DEPARTMENT") return false;
  if (entry.scopeType === "TEAM" || entry.scopeType === "PROJECT") {
    return !(organizationId === undefined || picked.scopeId === organizationId);
  }
  return true;
}

/** A team narrows from org-wide, and covers the projects under it. */
function keptBesideTeam(
  entry: ScopeChipPickerEntry,
  picked: ScopeChipPickerEntry,
  { organizationId, availableProjects }: CollapseContext,
): boolean {
  if (isOrganizationWide(entry, organizationId)) return false;
  if (entry.scopeType !== "PROJECT") return true;

  return availableProjects.find((p) => p.id === entry.scopeId)?.teamId !== picked.scopeId;
}

/** A project narrows from org-wide and from its own team. */
function keptBesideProject(
  entry: ScopeChipPickerEntry,
  parentTeamId: string | undefined,
  organizationId: string | undefined,
): boolean {
  if (isOrganizationWide(entry, organizationId)) return false;

  return !(
    entry.scopeType === "TEAM" &&
    parentTeamId !== undefined &&
    entry.scopeId === parentTeamId
  );
}

/**
 * The entries left once one new pick is taken in. Personal picks target a different slice:
 * "all personal projects" subsumes per-department personal picks, and a department's
 * personal pick narrows from it; plain department picks clear only the org-wide pick.
 */
function collapseForPick({
  entries,
  picked,
  context,
}: {
  entries: ScopeChipPickerEntry[];
  picked: ScopeChipPickerEntry;
  context: CollapseContext;
}): ScopeChipPickerEntry[] {
  const { organizationId, availableProjects } = context;
  if (picked.scopeType === "ORGANIZATION") {
    return picked.personalOnly
      ? entries.filter((s) => !(s.personalOnly && s.scopeType === "DEPARTMENT"))
      : entries.filter((s) => keptBesideOrganization(s, picked, organizationId));
  }
  if (picked.scopeType === "DEPARTMENT") {
    return picked.personalOnly
      ? entries.filter((s) => !(s.personalOnly && s.scopeType === "ORGANIZATION"))
      : entries.filter((s) => !isOrganizationWide(s, organizationId));
  }
  if (picked.scopeType === "TEAM") return entries.filter((s) => keptBesideTeam(s, picked, context));
  if (picked.scopeType === "PROJECT") {
    const parentTeamId = availableProjects.find((p) => p.id === picked.scopeId)?.teamId;
    return entries.filter((s) => keptBesideProject(s, parentTeamId, organizationId));
  }
  return entries;
}

// Chip-based scope picker; extracted for reuse across surfaces.
export function ScopeChipPicker<T extends ScopeChipPickerScopeType = ScopeTriadType>({
  value: inputValue,
  onChange: inputOnChange,
  organizationId,
  organizationName,
  teamId,
  teamName,
  projectId,
  projectName,
  availableTeams,
  availableProjects,
  availableDepartments,
  allowedScopeTypes,
  label = "Scope",
  subjectNoun = "configuration",
  showSummary = true,
  showQuickPicks = false,
  singleSelect = false,
  personalScopes = false,
  variant = "chips",
  placeholder,
  currentOrganizationId,
  currentTeamId,
  currentProjectId,
}: {
  /** Selected scopes. The element `scopeType` narrows the generic `T`, so a
   *  caller passing `ModelProviderScopeType` entries gets the same narrow
   *  type back from `onChange` - DEPARTMENT only flows where a caller opts
   *  in by passing wider entries + `allowedScopeTypes`. */
  value: { scopeType: T; scopeId: string; personalOnly?: boolean }[];
  onChange: (next: { scopeType: T; scopeId: string; personalOnly?: boolean }[]) => void;
  organizationId: string | undefined;
  organizationName?: string;
  teamId?: string | undefined;
  teamName?: string;
  projectId?: string;
  projectName?: string;
  /** Teams the caller can pick. Falls back to `[{id:teamId, name:teamName}]`. */
  availableTeams?: { id: string; name: string }[];
  /** Projects the caller can pick. Falls back to `[{id:projectId, name:projectName}]`. */
  availableProjects?: { id: string; name: string; teamId?: string }[];
  /** Departments the caller can pick. Only consulted when DEPARTMENT is in
   *  `allowedScopeTypes`. Sourced from `api.departments.list`. */
  availableDepartments?: { id: string; name: string }[];
  /** Which scope kinds to offer. Defaults to ORGANIZATION/TEAM/PROJECT (the
   *  model-provider triad). The tile catalog passes
   *  `["ORGANIZATION", "DEPARTMENT"]` to offer org-wide or per-department
   *  visibility only. Options outside this set are never rendered. */
  allowedScopeTypes?: T[];
  /** Override the field label. Defaults to "Scope". */
  label?: string;
  /** What the summary line calls the thing being scoped ("Only this project
   *  can use this configuration."). Defaults to "configuration". */
  subjectNoun?: string;
  /** When false, hides the helper "Shared across …" line below the field. */
  showSummary?: boolean;
  /** Single-scope mode: a row lives at exactly one (scopeType, scopeId).
   *  Renders the quick-pick chips as single-select. `value` stays an
   *  array; the component always collapses it to its first entry. */
  singleSelect?: boolean;
  // Variant: chips multi-select or single-select dropdown.
  variant?: "chips" | "single-select";
  /** Placeholder for the single-select trigger when nothing is picked yet.
   *  Defaults to "Select an option". Only consulted by the single-select
   *  variant. */
  placeholder?: string;
  /** When true, render Organization/Team/Project quick-pick chips above
   *  the field, collapsed by default; the "Multiple" chip reveals the
   *  multi-select dropdown for the rare multi-scope case. */
  showQuickPicks?: boolean;
  /** Offer the personal-projects variants in the dropdown: "All personal
   *  projects" (ORGANIZATION + personalOnly) and, when departments are
   *  available, each department's personal projects (DEPARTMENT +
   *  personalOnly). Emitted entries carry `personalOnly: true`. Off by
   *  default so existing consumers are unchanged. */
  personalScopes?: boolean;
  /** Current org/team/project IDs that drive the quick-pick chips.
   *  Independent from `organizationId/teamId/projectId` (which feed
   *  the dropdown options) so the quick-picks always pin to the
   *  user's working context even when the dropdown lists more. */
  currentOrganizationId?: string | null;
  currentTeamId?: string | null;
  currentProjectId?: string | null;
}) {
  // The component works with the wide ScopeChipPickerEntry internally; the
  // generic `T` only narrows the public value/onChange boundary so callers
  // get their own scope-type union back. `allowedScopeTypes` already gates
  // which kinds can ever be emitted, so the cast back to T on emit is sound.
  const value = inputValue as ScopeChipPickerEntry[];
  const onChange = (next: ScopeChipPickerEntry[]) =>
    inputOnChange(next as { scopeType: T; scopeId: string; personalOnly?: boolean }[]);

  const allowed = useMemo<Set<ScopeChipPickerScopeType>>(
    () => new Set((allowedScopeTypes ?? DEFAULT_SCOPE_TYPES) as ScopeChipPickerScopeType[]),
    [allowedScopeTypes],
  );

  const options = useMemo(
    () =>
      buildScopeOptions({
        allowed,
        organizationId,
        organizationName,
        availableDepartments,
        teams: listedOrCurrent({
          listed: availableTeams,
          currentId: teamId,
          currentName: teamName ?? "Team",
        }),
        projects: listedOrCurrent({
          listed: availableProjects,
          currentId: projectId,
          currentName: projectName ?? "Project",
        }),
        personalScopes,
      }),
    [
      allowed,
      availableDepartments,
      organizationId,
      organizationName,
      teamId,
      teamName,
      projectId,
      projectName,
      availableTeams,
      availableProjects,
      personalScopes,
    ],
  );

  // The search filter over a long option list. Matches an option's own
  // label and, for a project, its parent team's name, so "platform"
  // finds every project of the Platform team.
  const [scopeSearch, setScopeSearch] = useState("");
  const showSearch = options.length > SCOPE_SEARCH_THRESHOLD;
  const visibleOptions = useMemo(
    () =>
      showSearch
        ? searchScopeOptions({ options, search: scopeSearch, availableTeams, availableProjects })
        : options,
    [options, scopeSearch, showSearch, availableTeams, availableProjects],
  );

  const collection = useMemo(
    () => createListCollection({ items: visibleOptions }),
    [visibleOptions],
  );

  // In single-scope mode the picker represents exactly one scope, so the
  // value it operates on is collapsed to the first entry. In multi-scope mode
  // this is identical to `value`, so nothing downstream changes.
  const scopes = singleSelect ? value.slice(0, 1) : value;

  // Quick-pick row + collapsible-multi mode. See `showQuickPicks` prop.
  const quickPicks = useMemo(
    () => buildQuickPicks({ allowed, currentOrganizationId, currentTeamId, currentProjectId }),
    [allowed, currentOrganizationId, currentTeamId, currentProjectId],
  );
  const matchingQuickPick = useMemo(
    () => quickPickFor({ scopes, quickPicks }),
    [scopes, quickPicks],
  );

  // Local UI state; auto-flips on external multi-scope, never off except quick-pick.
  const derivedMultiple = !matchingQuickPick;
  const [multipleMode, setMultipleMode] = useState(derivedMultiple);
  useEffect(() => {
    if (derivedMultiple) setMultipleMode(true);
  }, [derivedMultiple]);

  const projectGroups = groupProjectOptions({
    projectOptions: visibleOptions.filter((o) => o.scopeType === "PROJECT"),
    availableTeams,
    availableProjects,
  });
  const search = { showSearch, scopeSearch, setScopeSearch };

  if (variant === "single-select") {
    return (
      <SingleScopeSelect
        label={label}
        collection={collection}
        options={options}
        visibleOptions={visibleOptions}
        projectGroups={projectGroups}
        scopes={scopes}
        placeholder={placeholder ?? "Select an option"}
        search={search}
        showSummary={showSummary}
        subjectNoun={subjectNoun}
        onChange={onChange}
      />
    );
  }

  return (
    <VStack align="start" width="full" gap={1.5}>
      {label && <SmallLabel>{label}</SmallLabel>}
      {(showQuickPicks || singleSelect) && quickPicks.length > 0 && (
        <QuickPickRow
          quickPicks={quickPicks}
          activeKey={multipleMode ? null : (matchingQuickPick?.key ?? null)}
          multipleMode={multipleMode}
          singleSelect={singleSelect}
          hasSelection={scopes.length > 0}
          onPick={(scope) => {
            setMultipleMode(false);
            onChange([scope]);
          }}
          onMultiple={() => setMultipleMode(true)}
        />
      )}
      {!singleSelect && (!showQuickPicks || multipleMode) && (
        <MultiScopeSelect
          collection={collection}
          options={options}
          visibleOptions={visibleOptions}
          projectGroups={projectGroups}
          scopes={scopes}
          search={search}
          onPick={(next) =>
            onChange(
              collapseRedundantScopes(next, scopes, {
                organizationId,
                availableProjects: listedOrCurrent({
                  listed: availableProjects,
                  currentId: projectId,
                  currentName: projectName ?? "Project",
                }),
              }),
            )
          }
        />
      )}
      {showSummary && <SelectionSummary scopes={scopes} subjectNoun={subjectNoun} />}
    </VStack>
  );
}

type QuickPick = {
  key: "ORGANIZATION" | "TEAM" | "PROJECT";
  label: string;
  icon: React.ReactElement;
  scope: ScopeChipPickerEntry;
};

type ProjectGroups = ReturnType<typeof groupProjectOptions>;

type ScopeSearch = {
  showSearch: boolean;
  scopeSearch: string;
  setScopeSearch: (next: string) => void;
};

/** Every option the picker offers, in display order, gated by `allowed`. */
function buildScopeOptions({
  allowed,
  organizationId,
  organizationName,
  availableDepartments,
  teams,
  projects,
  personalScopes,
}: {
  allowed: Set<ScopeChipPickerScopeType>;
  organizationId: string | undefined;
  organizationName: string | undefined;
  availableDepartments: { id: string; name: string }[] | undefined;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  personalScopes: boolean;
}): ScopeOption[] {
  const organization = organizationId && allowed.has("ORGANIZATION") ? organizationId : null;
  const departments = allowed.has("DEPARTMENT") ? (availableDepartments ?? []) : [];
  const out: ScopeOption[] = [];
  if (organization) {
    out.push(
      optionFor("ORGANIZATION", { id: organization, name: organizationName ?? "Organization" }),
    );
  }
  out.push(...departments.map((dept) => optionFor("DEPARTMENT", dept)));
  if (allowed.has("TEAM")) out.push(...teams.map((team) => optionFor("TEAM", team)));
  if (allowed.has("PROJECT")) out.push(...projects.map((project) => optionFor("PROJECT", project)));
  if (!personalScopes) return out;
  if (organization) {
    out.push({
      ...optionFor("ORGANIZATION", { id: organization, name: "All personal projects" }),
      value: `ORGANIZATION:${organization}:personal`,
      personalOnly: true,
    });
  }
  for (const dept of departments) {
    out.push({
      ...optionFor("DEPARTMENT", { id: dept.id, name: `Personal projects of ${dept.name}` }),
      value: `DEPARTMENT:${dept.id}:personal`,
      personalOnly: true,
    });
  }
  return out;
}

function optionFor(
  scopeType: ScopeChipPickerScopeType,
  { id, name }: { id: string; name: string },
): ScopeOption {
  return { value: `${scopeType}:${id}`, label: name, scopeType, scopeId: id };
}

function searchScopeOptions({
  options,
  search,
  availableTeams,
  availableProjects,
}: {
  options: ScopeOption[];
  search: string;
  availableTeams: { id: string; name: string }[] | undefined;
  availableProjects: { id: string; teamId?: string }[] | undefined;
}): ScopeOption[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return options;
  const teamNameById = new Map((availableTeams ?? []).map((t) => [t.id, t.name] as const));
  const teamIdByProjectId = new Map(
    (availableProjects ?? []).map((p) => [p.id, p.teamId] as const),
  );
  return options.filter((option) => {
    const teamName =
      option.scopeType === "PROJECT"
        ? teamNameById.get(teamIdByProjectId.get(option.scopeId) ?? "")
        : undefined;
    return `${teamName ?? ""} ${option.label}`.toLowerCase().includes(needle);
  });
}

function buildQuickPicks({
  allowed,
  currentOrganizationId,
  currentTeamId,
  currentProjectId,
}: {
  allowed: Set<ScopeChipPickerScopeType>;
  currentOrganizationId: string | null | undefined;
  currentTeamId: string | null | undefined;
  currentProjectId: string | null | undefined;
}): QuickPick[] {
  const out: QuickPick[] = [];
  if (currentOrganizationId && allowed.has("ORGANIZATION")) {
    out.push({
      key: "ORGANIZATION",
      label: "Organization",
      icon: <Building2 size={14} aria-hidden />,
      scope: { scopeType: "ORGANIZATION", scopeId: currentOrganizationId },
    });
  }
  if (currentTeamId && allowed.has("TEAM")) {
    out.push({
      key: "TEAM",
      label: "This team",
      icon: <Users size={14} aria-hidden />,
      scope: { scopeType: "TEAM", scopeId: currentTeamId },
    });
  }
  if (currentProjectId && allowed.has("PROJECT")) {
    out.push({
      key: "PROJECT",
      label: "This project",
      icon: <Folder size={14} aria-hidden />,
      scope: { scopeType: "PROJECT", scopeId: currentProjectId },
    });
  }
  return out;
}

/** The quick pick matching a one-scope selection, or null. */
function quickPickFor({
  scopes,
  quickPicks,
}: {
  scopes: ScopeChipPickerEntry[];
  quickPicks: QuickPick[];
}): QuickPick | null {
  const [only] = scopes;
  if (scopes.length !== 1 || !only) return null;
  return (
    quickPicks.find(
      (qp) => qp.scope.scopeType === only.scopeType && qp.scope.scopeId === only.scopeId,
    ) ?? null
  );
}

/** The selection an option stands for, carrying the personal flag only when set. */
function entryOf(option: ScopeOption): ScopeChipPickerEntry {
  return {
    scopeType: option.scopeType,
    scopeId: option.scopeId,
    ...(option.personalOnly ? { personalOnly: true } : {}),
  };
}

function SelectionSummary({
  scopes,
  subjectNoun,
}: {
  scopes: ScopeChipPickerEntry[];
  subjectNoun: string;
}) {
  return (
    <Box>
      <Text fontSize="xs" color="gray.600">
        {summariseSelection({ scopes, subjectNoun })}
      </Text>
    </Box>
  );
}

function OptionGroup({
  label,
  options,
  icon,
  indent = false,
}: {
  label: string;
  options: ScopeOption[];
  icon: React.ReactElement;
  indent?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <Select.ItemGroup label={label}>
      {options.map((option) => (
        <Select.Item key={option.value} item={option}>
          <HStack gap={2} paddingLeft={indent ? 2 : undefined}>
            {icon}
            <Text>{option.label}</Text>
          </HStack>
        </Select.Item>
      ))}
    </Select.ItemGroup>
  );
}

/** Projects under their team's name, so a long list stays readable; teamless ones stay flat. */
function ProjectOptionGroups({ teamGroups, orphanProjects }: ProjectGroups) {
  return (
    <>
      {teamGroups.map((group) => (
        <OptionGroup
          key={group.teamId}
          label={group.teamName}
          options={group.projects}
          icon={<ScopeIcon scopeType="PROJECT" />}
          indent
        />
      ))}
      <OptionGroup
        label="Projects"
        options={orphanProjects}
        icon={<ScopeIcon scopeType="PROJECT" />}
      />
    </>
  );
}

function SearchAndEmpty({ search, isEmpty }: { search: ScopeSearch; isEmpty: boolean }) {
  return (
    <>
      {search.showSearch && (
        <ScopeSearchField value={search.scopeSearch} onChange={search.setScopeSearch} />
      )}
      {isEmpty && (
        <Text paddingX={3} paddingY={2} fontSize="sm" color="fg.muted">
          No scopes match your search.
        </Text>
      )}
    </>
  );
}

function optionsOfType(options: ScopeOption[], scopeType: ScopeChipPickerScopeType) {
  return options.filter((o) => o.scopeType === scopeType);
}

/**
 * One scope from a dropdown. PROJECT options group under their parent team so the
 * list stays organised across teams; organization, department and team options keep
 * their own flat groups.
 */
function SingleScopeSelect({
  label,
  collection,
  options,
  visibleOptions,
  projectGroups,
  scopes,
  placeholder,
  search,
  showSummary,
  subjectNoun,
  onChange,
}: {
  label: string;
  collection: ListCollection<ScopeOption>;
  options: ScopeOption[];
  visibleOptions: ScopeOption[];
  projectGroups: ProjectGroups;
  scopes: ScopeChipPickerEntry[];
  placeholder: string;
  search: ScopeSearch;
  showSummary: boolean;
  subjectNoun: string;
  onChange: (next: ScopeChipPickerEntry[]) => void;
}) {
  const selected = scopes[0] ?? null;
  const selectedOption = selected ? options.find((o) => entryKey(o) === entryKey(selected)) : null;

  return (
    <VStack align="start" width="full" gap={1.5}>
      {label && <SmallLabel>{label}</SmallLabel>}
      <Select.Root
        collection={collection}
        value={selected ? [entryKey(selected)] : []}
        onOpenChange={(details) => {
          if (details.open) search.setScopeSearch("");
        }}
        onValueChange={(details) => {
          const option = options.find((o) => o.value === details.value[0]);
          onChange(option ? [entryOf(option)] : []);
        }}
      >
        <Select.Trigger>
          <Select.ValueText placeholder={placeholder}>
            {() =>
              selectedOption ? (
                <HStack gap={2}>
                  <ScopeIcon scopeType={selectedOption.scopeType} />
                  <Text>{selectedOption.label}</Text>
                </HStack>
              ) : (
                placeholder
              )
            }
          </Select.ValueText>
        </Select.Trigger>
        <Select.Content>
          <SearchAndEmpty search={search} isEmpty={visibleOptions.length === 0} />
          <OptionGroup
            label="Organization"
            options={optionsOfType(visibleOptions, "ORGANIZATION")}
            icon={<ScopeIcon scopeType="ORGANIZATION" />}
          />
          <OptionGroup
            label="Departments"
            options={optionsOfType(visibleOptions, "DEPARTMENT")}
            icon={<ScopeIcon scopeType="DEPARTMENT" />}
          />
          <OptionGroup
            label="Teams"
            options={optionsOfType(visibleOptions, "TEAM")}
            icon={<ScopeIcon scopeType="TEAM" />}
          />
          <ProjectOptionGroups {...projectGroups} />
        </Select.Content>
      </Select.Root>
      {showSummary && <SelectionSummary scopes={scopes} subjectNoun={subjectNoun} />}
    </VStack>
  );
}

/**
 * The quick picks, plus a 4th chip that collapses to the fast path for one scope or
 * exposes the multi-select dropdown for the long tail. Hidden in single-scope mode.
 * With zero scopes selected it is still the active chip, so it reads "None selected".
 */
function QuickPickRow({
  quickPicks,
  activeKey,
  multipleMode,
  singleSelect,
  hasSelection,
  onPick,
  onMultiple,
}: {
  quickPicks: QuickPick[];
  activeKey: QuickPick["key"] | null;
  multipleMode: boolean;
  singleSelect: boolean;
  hasSelection: boolean;
  onPick: (scope: ScopeChipPickerEntry) => void;
  onMultiple: () => void;
}) {
  return (
    <Wrap
      as="fieldset"
      gap={2}
      border={0}
      margin={0}
      padding={0}
      minWidth={0}
      aria-label="Quick scope"
    >
      {quickPicks.map((pick) => {
        const active = activeKey === pick.key;
        return (
          <Button
            key={`${pick.scope.scopeType}:${pick.scope.scopeId}`}
            type="button"
            size="xs"
            variant={active ? "solid" : "outline"}
            aria-pressed={active}
            onClick={() => onPick(pick.scope)}
            data-testid={`quick-scope-${pick.scope.scopeType.toLowerCase()}`}
          >
            <HStack gap={1}>
              {pick.icon}
              <Text>{pick.label}</Text>
            </HStack>
          </Button>
        );
      })}
      {!singleSelect && (
        <Button
          type="button"
          size="xs"
          variant={multipleMode ? "solid" : "outline"}
          aria-pressed={multipleMode}
          onClick={onMultiple}
          data-testid="quick-scope-multiple"
        >
          <HStack gap={1}>
            <CheckCheck size={14} aria-hidden />
            <Text>{hasSelection ? "Multiple" : "None selected"}</Text>
          </HStack>
        </Button>
      )}
    </Wrap>
  );
}

function MultiScopeSelect({
  collection,
  options,
  visibleOptions,
  projectGroups,
  scopes,
  search,
  onPick,
}: {
  collection: ListCollection<ScopeOption>;
  options: ScopeOption[];
  visibleOptions: ScopeOption[];
  projectGroups: ProjectGroups;
  scopes: ScopeChipPickerEntry[];
  search: ScopeSearch;
  onPick: (next: ScopeChipPickerEntry[]) => void;
}) {
  const plain = visibleOptions.filter((o) => !o.personalOnly);
  return (
    <Select.Root
      collection={collection}
      value={scopes.map(entryKey)}
      multiple
      onOpenChange={(details) => {
        if (details.open) search.setScopeSearch("");
      }}
      onValueChange={(details) => {
        const picked = new Set(details.value);
        onPick(options.filter((o) => picked.has(o.value)).map(entryOf));
      }}
    >
      <Select.Trigger>
        <Select.ValueText placeholder="Pick one or more scopes">
          {() => <SelectedScopeChips scopes={scopes} options={options} />}
        </Select.ValueText>
      </Select.Trigger>
      <Select.Content>
        <SearchAndEmpty search={search} isEmpty={visibleOptions.length === 0} />
        <OptionGroup
          label="Organization"
          options={optionsOfType(plain, "ORGANIZATION")}
          icon={<ScopeIcon scopeType="ORGANIZATION" />}
        />
        <OptionGroup
          label="Departments"
          options={optionsOfType(plain, "DEPARTMENT")}
          icon={<ScopeIcon scopeType="DEPARTMENT" />}
        />
        <OptionGroup
          label="Teams"
          options={optionsOfType(visibleOptions, "TEAM")}
          icon={<ScopeIcon scopeType="TEAM" />}
        />
        <ProjectOptionGroups {...projectGroups} />
        <OptionGroup
          label="Personal projects"
          options={visibleOptions.filter((o) => o.personalOnly)}
          icon={<UserLock size={16} aria-hidden />}
        />
      </Select.Content>
    </Select.Root>
  );
}

/**
 * The picked scopes as chips, hydrated with names from `options` so each reads
 * "LangWatch" / "Acme Team" / "web-app" instead of bare "Organization" / "Team".
 */
function SelectedScopeChips({
  scopes,
  options,
}: {
  scopes: ScopeChipPickerEntry[];
  options: ScopeOption[];
}) {
  if (scopes.length === 0) return "Pick one or more scopes";
  const named = scopes.map((v) => ({
    scopeType: v.scopeType,
    scopeId: v.scopeId,
    name: options.find((o) => o.value === entryKey(v))?.label,
  }));
  return <ProviderScopeChips scopes={named} />;
}
