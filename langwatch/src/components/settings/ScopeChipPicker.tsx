import {
  Box,
  Button,
  createListCollection,
  HStack,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react";
import {
  Boxes,
  Building2,
  CheckCheck,
  Folder,
  UserLock,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SmallLabel } from "../SmallLabel";
import { Select } from "../ui/select";
import { ProviderScopeChips } from "./ProviderScopeChips";

/**
 * Scope kinds the picker can offer. ORGANIZATION/TEAM/PROJECT mirror the
 * Prisma `ModelProviderScopeType` enum; DEPARTMENT is a picker-only
 * capability (no enum row) that consumers opt into via `allowedScopeTypes`
 * - the tile catalog offers ORGANIZATION + DEPARTMENT only, model
 * providers keep ORGANIZATION/TEAM/PROJECT. See
 * dev/docs/best_practices/scope-selector-and-badges.md.
 */
export type ScopeChipPickerScopeType =
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "DEPARTMENT";

/**
 * The model-provider triad - the scope kinds that map 1:1 to the Prisma
 * `ModelProviderScopeType` enum. Consumers that persist to scoped-resource
 * tables (model providers, VKs, budgets, routing policies, default models,
 * retention) type their selection with this narrow union so DEPARTMENT can
 * never leak into a DB write. The generic `ScopeChipPicker` narrows back to
 * whatever element type the caller's `value` carries.
 */
export type ScopeTriadType = "ORGANIZATION" | "TEAM" | "PROJECT";

/** Default offering: the model-provider triad. Consumers that want the
 *  department cut pass `allowedScopeTypes` explicitly. */
export const DEFAULT_SCOPE_TYPES: ScopeTriadType[] = [
  "ORGANIZATION",
  "TEAM",
  "PROJECT",
];

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

const SCOPE_DESCRIPTION_SINGLE: Record<ScopeChipPickerScopeType, string> = {
  PROJECT: "Only this project can use this configuration.",
  TEAM: "Every project in the team inherits this configuration.",
  ORGANIZATION:
    "Every project in the organization inherits this configuration.",
  DEPARTMENT: "Every member of this department can use this configuration.",
};

function summariseSelection(scopes: ScopeChipPickerEntry[]): string {
  if (scopes.length === 0) {
    return "Pick at least one scope.";
  }
  if (scopes.length === 1) {
    const only = scopes[0]!;
    if (only.personalOnly) {
      return only.scopeType === "ORGANIZATION"
        ? "Every personal workspace in the organization inherits this configuration."
        : "The personal workspaces of this department's members inherit this configuration.";
    }
    return SCOPE_DESCRIPTION_SINGLE[only.scopeType];
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
    parts.push(
      counts.DEPARTMENT === 1
        ? "1 department"
        : `${counts.DEPARTMENT} departments`,
    );
  if (counts.TEAM)
    parts.push(counts.TEAM === 1 ? "1 team" : `${counts.TEAM} teams`);
  if (counts.PROJECT)
    parts.push(
      counts.PROJECT === 1 ? "1 project" : `${counts.PROJECT} projects`,
    );
  if (personal.some((s) => s.scopeType === "ORGANIZATION")) {
    parts.push("all personal projects");
  }
  const personalDepartments = personal.filter(
    (s) => s.scopeType === "DEPARTMENT",
  ).length;
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
 * Collapses redundant selections after the user picks a new scope.
 *
 * Rules (lineage-only, never touches scopes outside the picked one's
 * branch - so cross-team and cross-department selections survive):
 *
 *   - Picking an ORGANIZATION drops every TEAM, PROJECT, and DEPARTMENT.
 *     The org-wide row supersedes them; keeping both would render two
 *     chips with one effective grant.
 *   - Picking a TEAM drops the parent organization AND every PROJECT
 *     under that team. The narrower team scope is the user's intent.
 *   - Picking a PROJECT drops the parent organization AND the parent
 *     team (if either is selected). Same intent narrowing - without
 *     this an "Org X + Project P" pair silently means "everyone in X
 *     including P", which is the trip-up the user flagged.
 *   - Picking a DEPARTMENT drops the organization (department narrows
 *     from org-wide). Departments are mutually-compatible SIBLINGS -
 *     picking one never clears another, so a tile can target several
 *     departments at once.
 *
 * ORGANIZATION and DEPARTMENT are mutually exclusive: an org-wide pick
 * clears departments, and a department pick clears the org. The tile
 * catalog (the only DEPARTMENT consumer today) relies on exactly this.
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
  const prevKey = new Set(prev.map(entryKey));
  const added = next.filter((s) => !prevKey.has(entryKey(s)));
  if (added.length === 0) return next;

  const { organizationId, availableProjects } = context;
  let cleaned = next;
  for (const picked of added) {
    if (picked.scopeType === "ORGANIZATION" && !picked.personalOnly) {
      // The picker is single-org-scoped, so every team and project in
      // `next` belongs to this org by construction. Dropping them - plus
      // every department and every personal variant (the org-wide rule
      // covers personal projects too) - collapses to the single ORG chip.
      cleaned = cleaned.filter((s) => {
        if (s.personalOnly) return false;
        if (s.scopeType === "DEPARTMENT") return false;
        if (s.scopeType === "TEAM" || s.scopeType === "PROJECT") {
          // Defensive guard: only collapse children that belong to the
          // picked org. With multi-org pickers this gates the collapse
          // to the lineage.
          return !(
            organizationId === undefined || picked.scopeId === organizationId
          );
        }
        return true;
      });
    } else if (picked.scopeType === "ORGANIZATION" && picked.personalOnly) {
      // "All personal projects" subsumes the per-department personal picks
      // but coexists with every plain scope (it targets a different slice).
      cleaned = cleaned.filter(
        (s) => !(s.personalOnly && s.scopeType === "DEPARTMENT"),
      );
    } else if (picked.scopeType === "DEPARTMENT" && picked.personalOnly) {
      // A department's personal projects narrow from "all personal
      // projects", so the org-personal pick goes; siblings coexist.
      cleaned = cleaned.filter(
        (s) => !(s.personalOnly && s.scopeType === "ORGANIZATION"),
      );
    } else if (picked.scopeType === "DEPARTMENT") {
      // A department narrows from org-wide, so it clears the org pick.
      // Sibling departments are mutually compatible and left untouched.
      cleaned = cleaned.filter(
        (s) =>
          !(
            s.scopeType === "ORGANIZATION" &&
            !s.personalOnly &&
            organizationId !== undefined &&
            s.scopeId === organizationId
          ),
      );
    } else if (picked.scopeType === "TEAM") {
      cleaned = cleaned.filter((s) => {
        // Parent org goes - team narrows the scope. Personal variants
        // target a different slice and stay.
        if (
          s.scopeType === "ORGANIZATION" &&
          !s.personalOnly &&
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
          !s.personalOnly &&
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
export function ScopeChipPicker<
  T extends ScopeChipPickerScopeType = ScopeTriadType,
>({
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
  value: Array<{ scopeType: T; scopeId: string; personalOnly?: boolean }>;
  onChange: (
    next: Array<{ scopeType: T; scopeId: string; personalOnly?: boolean }>,
  ) => void;
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
  /** Departments the caller can pick. Only consulted when DEPARTMENT is in
   *  `allowedScopeTypes`. Sourced from `api.departments.list`. */
  availableDepartments?: Array<{ id: string; name: string }>;
  /** Which scope kinds to offer. Defaults to ORGANIZATION/TEAM/PROJECT (the
   *  model-provider triad). The tile catalog passes
   *  `["ORGANIZATION", "DEPARTMENT"]` to offer org-wide or per-department
   *  visibility only. Options outside this set are never rendered. */
  allowedScopeTypes?: T[];
  /** Override the field label. Defaults to "Scope". */
  label?: string;
  /** When false, hides the helper "Shared across …" line below the field. */
  showSummary?: boolean;
  /** Single-scope mode: a row may live at exactly one scope (inline
   *  (scopeType, scopeId) resources like model costs / budgets). Renders the
   *  org/team/project quick-pick chips as a single-select, drops the
   *  "Multiple" chip and the multi-select dropdown entirely. `value` is still
   *  an array; the component collapses it to its first entry and never emits
   *  more than one, so the single-scope contract holds even if a caller passes
   *  a longer array. */
  singleSelect?: boolean;
  /** Rendering variant.
   *  - "chips" (default): the chip + multi-select / quick-pick UI, governed by
   *    `singleSelect` / `showQuickPicks`.
   *  - "single-select": a single-value dropdown over the full option list. The
   *    component guarantees exactly one selection (or none), so callers never
   *    constrain `onChange` themselves. PROJECT options nest under their team
   *    (using `availableProjects[].teamId` + `availableTeams`) so the list
   *    stays organised, and the trigger collapses to the picked option. Use
   *    this to pick one concrete scope (e.g. the project an SDK key is minted
   *    for) rather than choose a scope level for a config. */
  variant?: "chips" | "single-select";
  /** Placeholder for the single-select trigger when nothing is picked yet.
   *  Defaults to "Select an option". Only consulted by the single-select
   *  variant. */
  placeholder?: string;
  /** When true, render the Organization/Team/Project quick-pick chip
   *  row above the field and collapse the multi-select dropdown by
   *  default. Clicking the 4th "Multiple" chip (CheckCheck icon)
   *  reveals the dropdown for fine-grained selection. The 99% case is
   *  one scope; this keeps the picker quiet for that case and the
   *  rare multi-scope policies stay one click away. */
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
    inputOnChange(
      next as Array<{ scopeType: T; scopeId: string; personalOnly?: boolean }>,
    );

  const allowed = useMemo<Set<ScopeChipPickerScopeType>>(
    () =>
      new Set(
        (allowedScopeTypes ??
          DEFAULT_SCOPE_TYPES) as ScopeChipPickerScopeType[],
      ),
    [allowedScopeTypes],
  );

  const options = useMemo<ScopeOption[]>(() => {
    const out: ScopeOption[] = [];
    if (organizationId && allowed.has("ORGANIZATION")) {
      out.push({
        value: `ORGANIZATION:${organizationId}`,
        label: organizationName ?? "Organization",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      });
    }
    if (allowed.has("DEPARTMENT")) {
      for (const dept of availableDepartments ?? []) {
        out.push({
          value: `DEPARTMENT:${dept.id}`,
          label: dept.name,
          scopeType: "DEPARTMENT",
          scopeId: dept.id,
        });
      }
    }
    if (allowed.has("TEAM")) {
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
    }
    if (allowed.has("PROJECT")) {
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
    }
    if (personalScopes) {
      if (organizationId && allowed.has("ORGANIZATION")) {
        out.push({
          value: `ORGANIZATION:${organizationId}:personal`,
          label: "All personal projects",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          personalOnly: true,
        });
      }
      if (allowed.has("DEPARTMENT")) {
        for (const dept of availableDepartments ?? []) {
          out.push({
            value: `DEPARTMENT:${dept.id}:personal`,
            label: `Personal projects of ${dept.name}`,
            scopeType: "DEPARTMENT",
            scopeId: dept.id,
            personalOnly: true,
          });
        }
      }
    }
    return out;
  }, [
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
  ]);

  const collection = useMemo(
    () => createListCollection({ items: options }),
    [options],
  );

  // In single-scope mode the picker represents exactly one scope, so the
  // value it operates on is collapsed to the first entry. In multi-scope mode
  // this is identical to `value`, so nothing downstream changes.
  const scopes = singleSelect ? value.slice(0, 1) : value;

  const selectedValues = useMemo(() => scopes.map(entryKey), [scopes]);

  // Quick-pick row + collapsible-multi mode. See `showQuickPicks` prop.
  const quickPicks = useMemo(() => {
    const out: Array<{
      key: "ORGANIZATION" | "TEAM" | "PROJECT";
      label: string;
      icon: React.ReactElement;
      scope: ScopeChipPickerEntry;
    }> = [];
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
  }, [allowed, currentOrganizationId, currentTeamId, currentProjectId]);

  const matchingQuickPick = useMemo(() => {
    if (scopes.length !== 1) return null;
    const s = scopes[0]!;
    return (
      quickPicks.find(
        (qp) =>
          qp.scope.scopeType === s.scopeType && qp.scope.scopeId === s.scopeId,
      ) ?? null
    );
  }, [scopes, quickPicks]);

  // `multipleMode` is local UI state: when true the dropdown is
  // visible and the "Multiple" chip is highlighted. Derived from the
  // current selection on mount; afterwards it only auto-FLIPS-ON (when
  // an external selection change creates a multi-scope state) and
  // NEVER auto-flips-off. The reverse direction would collapse the
  // dropdown mid-edit - e.g. a user in Multiple mode who deselects
  // one of two scopes transiently has a single-quick-pick value, and
  // collapsing the dropdown before they pick the second team is the
  // exact UX paper-cut that surfaced on 2026-05-18. Quick-pick chip
  // clicks are the only path that turns multipleMode off.
  const derivedMultiple = !matchingQuickPick;
  const [multipleMode, setMultipleMode] = useState(derivedMultiple);
  useEffect(() => {
    if (derivedMultiple) setMultipleMode(true);
  }, [derivedMultiple]);

  const dropdownVisible = singleSelect
    ? false
    : !showQuickPicks || multipleMode;

  if (variant === "single-select") {
    const selected = scopes[0] ?? null;
    const selectedOption = selected
      ? options.find(
          (o) =>
            o.scopeType === selected.scopeType &&
            o.scopeId === selected.scopeId,
        )
      : null;

    // Group PROJECT options under their parent team so the list stays organised
    // even with many projects across teams. Non-project options (org / team /
    // department) keep their own flat groups.
    const teamNameById = new Map(
      (availableTeams ?? []).map((t) => [t.id, t.name] as const),
    );
    const teamIdByProjectId = new Map(
      (availableProjects ?? []).map((p) => [p.id, p.teamId] as const),
    );
    const projectsByTeam = new Map<string, ScopeOption[]>();
    const orphanProjects: ScopeOption[] = [];
    for (const option of options.filter((o) => o.scopeType === "PROJECT")) {
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
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
    const orgOptions = options.filter((o) => o.scopeType === "ORGANIZATION");
    const deptOptions = options.filter((o) => o.scopeType === "DEPARTMENT");
    const teamScopeOptions = options.filter((o) => o.scopeType === "TEAM");
    const fallbackPlaceholder = placeholder ?? "Select an option";

    return (
      <VStack align="start" width="full" gap={1.5}>
        {label && <SmallLabel>{label}</SmallLabel>}
        <Select.Root
          collection={collection}
          value={selected ? [`${selected.scopeType}:${selected.scopeId}`] : []}
          onValueChange={(details) => {
            const pickedValue = details.value[0];
            const option = pickedValue
              ? options.find((o) => o.value === pickedValue)
              : undefined;
            onChange(
              option
                ? [{ scopeType: option.scopeType, scopeId: option.scopeId }]
                : [],
            );
          }}
        >
          <Select.Trigger>
            <Select.ValueText placeholder={fallbackPlaceholder}>
              {() =>
                selectedOption ? (
                  <HStack gap={2}>
                    <ScopeIcon scopeType={selectedOption.scopeType} />
                    <Text>{selectedOption.label}</Text>
                  </HStack>
                ) : (
                  fallbackPlaceholder
                )
              }
            </Select.ValueText>
          </Select.Trigger>
          <Select.Content>
            {orgOptions.length > 0 && (
              <Select.ItemGroup label="Organization">
                {orgOptions.map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="ORGANIZATION" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
              </Select.ItemGroup>
            )}
            {deptOptions.length > 0 && (
              <Select.ItemGroup label="Departments">
                {deptOptions.map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="DEPARTMENT" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
              </Select.ItemGroup>
            )}
            {teamScopeOptions.length > 0 && (
              <Select.ItemGroup label="Teams">
                {teamScopeOptions.map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="TEAM" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
              </Select.ItemGroup>
            )}
            {teamGroups.map((group) => (
              <Select.ItemGroup key={group.teamId} label={group.teamName}>
                {group.projects.map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2} paddingLeft={2}>
                      <ScopeIcon scopeType="PROJECT" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
              </Select.ItemGroup>
            ))}
            {orphanProjects.length > 0 && (
              <Select.ItemGroup label="Projects">
                {orphanProjects.map((option) => (
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
        {showSummary && (
          <Box>
            <Text fontSize="xs" color="gray.600">
              {summariseSelection(scopes)}
            </Text>
          </Box>
        )}
      </VStack>
    );
  }

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
          {/* 4th chip - collapses to the same fast path for the 99%
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
              .map((o) => ({
                scopeType: o.scopeType,
                scopeId: o.scopeId,
                ...(o.personalOnly ? { personalOnly: true } : {}),
              }));
            onChange(
              collapseRedundantScopes(next, scopes, {
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
                if (scopes.length === 0) return "Pick one or more scopes";
                // Hydrate the chips with names looked up from the picker's
                // `options` so each chip reads "LangWatch" / "Acme Team" /
                // "web-app" instead of bare "Organization" / "Team" /
                // "Project". Without this, multiple teams render as
                // identical "Team", "Team" pills - the bug rchaves caught
                // in the model-provider drawer screenshot.
                const named = scopes.map((v) => {
                  const match = options.find((o) => o.value === entryKey(v));
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
            {options.some(
              (o) => o.scopeType === "ORGANIZATION" && !o.personalOnly,
            ) && (
              <Select.ItemGroup label="Organization">
                {options
                  .filter(
                    (o) => o.scopeType === "ORGANIZATION" && !o.personalOnly,
                  )
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
            {options.some(
              (o) => o.scopeType === "DEPARTMENT" && !o.personalOnly,
            ) && (
              <Select.ItemGroup label="Departments">
                {options
                  .filter(
                    (o) => o.scopeType === "DEPARTMENT" && !o.personalOnly,
                  )
                  .map((option) => (
                    <Select.Item key={option.value} item={option}>
                      <HStack gap={2}>
                        <ScopeIcon scopeType="DEPARTMENT" />
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
            {options.some((o) => o.personalOnly) && (
              <Select.ItemGroup label="Personal projects">
                {options
                  .filter((o) => o.personalOnly)
                  .map((option) => (
                    <Select.Item key={option.value} item={option}>
                      <HStack gap={2}>
                        <UserLock size={16} aria-hidden />
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
            {summariseSelection(scopes)}
          </Text>
        </Box>
      )}
    </VStack>
  );
}
