import {
  Box,
  Button,
  HStack,
  IconButton,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Building2,
  Check,
  ChevronDown,
  Folder,
  Plus,
  User,
  Users,
} from "lucide-react";
import React, { useState } from "react";
import { useRouter } from "~/utils/compat/next-router";

import { Menu } from "./ui/menu";
import { Link } from "./ui/link";
import { ProjectAvatar } from "./ProjectAvatar";
import { Tooltip } from "./ui/tooltip";

import { useWorkspaceCurrent } from "./useWorkspaceCurrent";

// Public shape consumed by the switcher. Keeping this minimal lets the
// caller source from anywhere — the Sergey tRPC `user.personalContext` once
// it lands, or the existing `useOrganizationTeamProject` shaped to fit.
export type WorkspaceSwitcherEntry =
  | {
      kind: "personal";
      /**
       * Org this personal workspace belongs to. Drives the per-org nesting for
       * multi-governance-org users (the personal entry renders under its org
       * header). null for an org-less user, whose single personal entry renders
       * standalone.
       */
      orgId: string | null;
      orgName?: string;
      orgSlug?: string;
      href: string;
      label: string;
      subtitle?: string;
    }
  | {
      kind: "team";
      teamId: string;
      teamSlug: string;
      orgId: string;
      orgName: string;
      orgSlug: string;
      href: string;
      label: string;
      subtitle?: string;
      /**
       * Whether the current user may create a project in this team (org or
       * team admin). Drives the per-team "Create project" affordance — viewers
       * never see it. Defaults to false when omitted.
       */
      canCreateProject?: boolean;
    }
  | {
      kind: "project";
      projectId: string;
      projectSlug: string;
      /**
       * Parent-team id. Drives the nested-under-team grouping in the
       * dropdown so the visible hierarchy matches the data model
       * (Project ⊂ Team ⊂ Org). Projects whose `teamId` doesn't match
       * any provided team fall back into a flat "Projects" group.
       */
      teamId: string;
      orgId: string;
      orgName: string;
      orgSlug: string;
      href: string;
      label: string;
      subtitle?: string;
    };

export type WorkspaceSwitcherCurrent =
  // `orgId` selects which org's personal entry is active for multi-org users;
  // omitted for single-org / org-less users (their one personal entry matches).
  | { kind: "personal"; orgId?: string }
  | { kind: "team"; teamId: string }
  | { kind: "project"; projectId: string }
  // Org-scoped routes (`/settings/*`, `/governance`) carry no project context.
  // The switcher shows the org as the current chip and offers the full
  // personal/team/project list so the user can jump back into a workspace.
  | { kind: "organization"; orgId: string; orgName: string }
  | { kind: "unknown" };

/**
 * One organization the user belongs to, for the in-place org switch offered on
 * org-scoped routes. Kept separate from `WorkspaceSwitcherEntry` because
 * switching org is a context change (writes `selectedOrganizationId`), not a
 * navigation to a single href.
 */
export type WorkspaceSwitcherOrganization = {
  orgId: string;
  orgName: string;
  orgSlug: string;
};

export type WorkspaceSwitcherProps = {
  /**
   * The "My Workspace" personal entries, one per organization that enables
   * governance. Empty when the personal portal is unavailable (no organization
   * has the governance flag), so the switcher hides it rather than linking to a
   * page that 404s. A single entry renders as a top-level "My Workspace" group;
   * multiple entries nest under each org's header (multi-governance-org users).
   */
  personals?: Array<Extract<WorkspaceSwitcherEntry, { kind: "personal" }>>;
  teams: Array<Extract<WorkspaceSwitcherEntry, { kind: "team" }>>;
  projects: Array<Extract<WorkspaceSwitcherEntry, { kind: "project" }>>;
  /**
   * Currently-selected context. When omitted, the switcher derives it from
   * the router pathname + the user's resolved org/team/project context via
   * `useWorkspaceCurrent`. Pass an explicit value only when overriding the
   * URL-driven selection (e.g. tests, programmatic preview cards).
   */
  current?: WorkspaceSwitcherCurrent;
  /**
   * Invoked when the user clicks a team row's "Create project" button. The
   * consumer opens the create-project drawer scoped to that team. The button
   * only renders for teams whose `canCreateProject` is true and only when
   * this callback is provided.
   */
  onCreateProjectForTeam?: (args: { teamId: string; orgId: string }) => void;
  /**
   * The user's organizations, surfaced as an in-place org switch on org-scoped
   * routes. Only rendered when `current.kind === "organization"` and the user
   * belongs to more than one org. Omitted on project/personal routes.
   */
  organizations?: WorkspaceSwitcherOrganization[];
  /**
   * Invoked when the user picks a different org from the org-switch group.
   * The consumer writes `selectedOrganizationId` and navigates to a route
   * valid for any org (e.g. `/settings`).
   */
  onSwitchOrganization?: (orgId: string) => void;
};

const ICON_BY_KIND = {
  personal: User,
  team: Users,
  project: Folder,
  organization: Building2,
} as const;

function entryIsCurrent(
  entry: WorkspaceSwitcherEntry,
  current: WorkspaceSwitcherCurrent,
): boolean {
  if (entry.kind === "personal") {
    if (current.kind !== "personal") return false;
    // Single / org-less users have one personal entry, so any personal current
    // matches it. Multi-org users match on org so only the selected org's
    // personal row shows the check.
    return (current.orgId ?? null) === (entry.orgId ?? null);
  }
  if (entry.kind === "team") {
    return current.kind === "team" && current.teamId === entry.teamId;
  }
  return (
    current.kind === "project" && current.projectId === entry.projectId
  );
}

function currentLabel(
  current: WorkspaceSwitcherCurrent,
  personals: WorkspaceSwitcherProps["personals"],
  teams: WorkspaceSwitcherProps["teams"],
  projects: WorkspaceSwitcherProps["projects"],
): { label: string; kind: keyof typeof ICON_BY_KIND } {
  if (current.kind === "personal") {
    const match =
      personals?.find((p) => (p.orgId ?? null) === (current.orgId ?? null)) ??
      personals?.[0];
    return { label: match?.label ?? "My Workspace", kind: "personal" };
  }
  if (current.kind === "team") {
    const t = teams.find((t) => t.teamId === current.teamId);
    return { label: t?.label ?? "Team", kind: "team" };
  }
  if (current.kind === "project") {
    const p = projects.find((p) => p.projectId === current.projectId);
    return { label: p?.label ?? "Project", kind: "project" };
  }
  if (current.kind === "organization") {
    return { label: current.orgName, kind: "organization" };
  }
  return { label: "Choose workspace", kind: "personal" };
}

/**
 * Top-left workspace context switcher. Mirrors the Project ⊂ Team ⊂ Org
 * hierarchy of the data model:
 *
 *   1. My Workspace (always present, always first)
 *   2. Each team (alpha-sorted), with its projects nested directly underneath
 *   3. Orphan projects whose teamId doesn't match any provided team
 *      (fallback flat "Projects" group — should be empty in practice)
 *
 * Project rows render the colored ProjectAvatar bubble (same component
 * the legacy ProjectSelector used) so projects stay visually identifiable
 * by their team-color.
 *
 * Consumes data via props so it can mount in any layout (DashboardLayout,
 * MyLayout, future SettingsLayout) without coupling to a specific data hook.
 *
 * Spec: specs/ai-gateway/governance/workspace-switcher.feature
 */
export const WorkspaceSwitcher = React.memo(function WorkspaceSwitcher({
  personals = [],
  teams,
  projects,
  current: currentProp,
  onCreateProjectForTeam,
  organizations,
  onSwitchOrganization,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const derivedCurrent = useWorkspaceCurrent({ teams, projects });
  const current = currentProp ?? derivedCurrent;

  const { label: triggerLabel, kind: triggerKind } = currentLabel(
    current,
    personals,
    teams,
    projects,
  );
  const TriggerIcon = ICON_BY_KIND[triggerKind];
  // For project context, render the colored ProjectAvatar in the trigger to
  // preserve parity with the legacy ProjectSelector — projects are visually
  // identified by their team-color bubble across the rest of the app.
  const triggerProjectName =
    triggerKind === "project" ? triggerLabel : null;

  // On org-scoped routes, offer the in-place org switch when the user belongs
  // to more than one org. The active org is the current chip, so it is not a
  // navigation target - it just gets the checkmark.
  const orgSwitchList =
    current.kind === "organization" && onSwitchOrganization
      ? (organizations ?? [])
      : [];
  const showOrgSwitch = orgSwitchList.length > 1;

  // "My Workspace" is a switch target only when it isn't already the current
  // context, so an org-scoped chip with no team projects still opens (the user
  // can jump back to personal) while a personal-only user - who has nowhere
  // else to go - keeps the disabled chip.
  const canGoPersonal = personals.length > 0 && current.kind !== "personal";
  const hasMore =
    canGoPersonal ||
    personals.length > 1 ||
    teams.length > 0 ||
    projects.length > 0 ||
    showOrgSwitch;

  // Group projects under their parent team for the nested-hierarchy render.
  // Anything whose teamId doesn't match a known team falls into the orphan
  // bucket (rare; happens only if projects+teams arrays drift).
  const projectsByTeam = new Map<string, typeof projects>();
  const orphanProjects: typeof projects = [];
  const knownTeamIds = new Set(teams.map((t) => t.teamId));
  for (const project of projects) {
    if (knownTeamIds.has(project.teamId)) {
      const bucket = projectsByTeam.get(project.teamId) ?? [];
      bucket.push(project);
      projectsByTeam.set(project.teamId, bucket);
    } else {
      orphanProjects.push(project);
    }
  }

  // Hide teams with zero projects — they're navigation dead-ends in the
  // dropdown (clicking the team name takes you to /settings/teams/<slug>
  // which is admin-only). Empty teams are an org-admin curiosity, not a
  // workspace-switcher target. Re-add later if rchaves wants team-level
  // usage as a discoverable surface.
  const teamsWithProjects = teams.filter(
    (team) => (projectsByTeam.get(team.teamId) ?? []).length > 0,
  );

  // Group teams by org so multi-org users see clear org boundaries instead
  // of flattened lists of same-named teams from different orgs (Acme P3
  // dogfood reproduces this). Single-org users see no org header at all —
  // teams flow directly under "My Workspace" since the org context is
  // implicit. Same-name orgs are disambiguated by their slug.
  const teamsByOrg = new Map<
    string,
    { orgName: string; orgSlug: string; teams: typeof teams }
  >();
  for (const team of teamsWithProjects) {
    const bucket =
      teamsByOrg.get(team.orgId) ?? {
        orgName: team.orgName,
        orgSlug: team.orgSlug,
        teams: [] as typeof teams,
      };
    bucket.teams.push(team);
    teamsByOrg.set(team.orgId, bucket);
  }
  const teamOrgs = Array.from(teamsByOrg.entries()).map(([orgId, value]) => ({
    orgId,
    orgName: value.orgName,
    orgSlug: value.orgSlug,
    teams: value.teams,
  }));

  // Personal "My Workspace" entries, keyed by org for the per-org nesting.
  // More than one governance org → nest each personal under its org header.
  // A single (or org-less) personal stays a top-level "My Workspace" group so
  // single-org users keep the simpler, header-free layout.
  const orgPersonals = personals.filter((p) => p.orgId);
  const multiPersonal = orgPersonals.length > 1;
  // Only nest per-org when there are multiple governance orgs; a single (or
  // org-less) personal stays the top-level entry and must NOT also render under
  // its org header (that would duplicate the "My Workspace" row).
  const personalByOrgId = multiPersonal
    ? new Map(orgPersonals.map((p) => [p.orgId as string, p]))
    : new Map<string, (typeof personals)[number]>();
  const topLevelPersonal = multiPersonal ? undefined : personals[0];

  // When nesting per org, include governance orgs the user has a personal in
  // but no visible team in — otherwise their "My Workspace" row would vanish.
  const teamOrgIds = new Set(teamOrgs.map((o) => o.orgId));
  const personalOnlyOrgs = multiPersonal
    ? personals
        .filter((p) => p.orgId && !teamOrgIds.has(p.orgId))
        .map((p) => ({
          orgId: p.orgId as string,
          orgName: p.orgName ?? "Organization",
          orgSlug: p.orgSlug ?? "",
          teams: [] as typeof teams,
        }))
    : [];
  const orgs = [...teamOrgs, ...personalOnlyOrgs].sort((a, b) =>
    a.orgName.localeCompare(b.orgName),
  );
  const multipleOrgs = orgs.length > 1;
  // Disambiguate same-name orgs: append slug to any name that appears
  // more than once across the user's orgs. Single-org users see nothing
  // (no header rendered for them anyway).
  const orgNameCount = orgs.reduce<Record<string, number>>((acc, o) => {
    acc[o.orgName] = (acc[o.orgName] ?? 0) + 1;
    return acc;
  }, {});
  const orgHeader = (org: { orgName: string; orgSlug: string }) =>
    (orgNameCount[org.orgName] ?? 0) > 1
      ? `${org.orgName} · ${org.orgSlug}`
      : org.orgName;

  return (
    <Menu.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          fontSize="13px"
          paddingX={2}
          paddingY={1}
          height="auto"
          fontWeight="normal"
          minWidth="fit-content"
          color="fg"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Switch workspace (current: ${triggerLabel})`}
          _hover={{ backgroundColor: "bg.muted" }}
          _disabled={{ opacity: 1, cursor: "default" }}
          disabled={!hasMore}
        >
          <HStack gap={2}>
            {triggerProjectName ? (
              <ProjectAvatar name={triggerProjectName} />
            ) : (
              <TriggerIcon size={14} />
            )}
            <Text>{triggerLabel}</Text>
            {hasMore && <ChevronDown size={14} />}
          </HStack>
        </Button>
      </Menu.Trigger>
      <Portal>
        <Box zIndex="popover" padding={0}>
          {open && (
            <Menu.Content minWidth="280px" maxHeight="70vh" overflowY="auto">
              {showOrgSwitch && (
                <Group title="Organizations">
                  {orgSwitchList.map((org) => {
                    const active =
                      current.kind === "organization" &&
                      current.orgId === org.orgId;
                    return (
                      <Menu.Item
                        key={org.orgId}
                        value={`org:${org.orgId}`}
                        fontSize="14px"
                        paddingY="5px"
                        onClick={() => {
                          setOpen(false);
                          onSwitchOrganization?.(org.orgId);
                        }}
                      >
                        <HStack gap={3} width="full" alignItems="center">
                          <Box
                            width="20px"
                            display="flex"
                            justifyContent="center"
                            flexShrink={0}
                          >
                            <Building2 size={14} />
                          </Box>
                          <Text
                            fontWeight={active ? "semibold" : "normal"}
                            truncate
                            flex={1}
                            minWidth={0}
                          >
                            {org.orgName}
                          </Text>
                          {active && (
                            <Box color="fg.muted" flexShrink={0}>
                              <Check size={14} />
                            </Box>
                          )}
                        </HStack>
                      </Menu.Item>
                    );
                  })}
                </Group>
              )}

              {topLevelPersonal && (
                <Group title="My Workspace">
                  <SwitcherItem
                    entry={topLevelPersonal}
                    // The sole top-level personal entry is the personal context,
                    // so it is active on any /me route regardless of which org
                    // is selected (per-org matching only matters when nested).
                    active={current.kind === "personal"}
                    onSelect={() => {
                      setOpen(false);
                      void router.push(topLevelPersonal.href);
                    }}
                  />
                </Group>
              )}

              {orgs.map((org) => {
                const orgPersonal = personalByOrgId.get(org.orgId);
                return (
                <Group
                  key={org.orgId}
                  title={multipleOrgs ? orgHeader(org) : undefined}
                >
                  {orgPersonal && (
                    <SwitcherItem
                      entry={orgPersonal}
                      active={entryIsCurrent(orgPersonal, current)}
                      onSelect={() => {
                        setOpen(false);
                        void router.push(orgPersonal.href);
                      }}
                    />
                  )}
                  {org.teams.map((team) => {
                    const teamProjects = projectsByTeam.get(team.teamId) ?? [];
                    return (
                      <Box key={team.teamId}>
                        <Box position="relative">
                          <SwitcherItem
                            entry={team}
                            active={entryIsCurrent(team, current)}
                            onSelect={() => {
                              setOpen(false);
                              void router.push(team.href);
                            }}
                          />
                          {team.canCreateProject && onCreateProjectForTeam && (
                            <TeamCreateProjectButton
                              team={team}
                              onCreateProjectForTeam={onCreateProjectForTeam}
                              setOpen={setOpen}
                            />
                          )}
                        </Box>
                        {teamProjects.length > 0 && (
                          <VStack gap={0} align="stretch" paddingLeft={5}>
                            {teamProjects.map((project) => (
                              <SwitcherItem
                                key={project.projectId}
                                entry={project}
                                active={entryIsCurrent(project, current)}
                                onSelect={() => {
                                  setOpen(false);
                                  void router.push(project.href);
                                }}
                              />
                            ))}
                          </VStack>
                        )}
                      </Box>
                    );
                  })}
                </Group>
                );
              })}

              {orphanProjects.length > 0 && (
                <Group title="Projects">
                  {orphanProjects.map((project) => (
                    <SwitcherItem
                      key={project.projectId}
                      entry={project}
                      active={entryIsCurrent(project, current)}
                      onSelect={() => {
                        setOpen(false);
                        void router.push(project.href);
                      }}
                    />
                  ))}
                </Group>
              )}

              {!hasMore && (
                <Box paddingX={3} paddingY={2}>
                  <Text fontSize="xs" color="fg.muted">
                    Ask your admin to add you to a team to see more contexts
                    here.
                  </Text>
                </Box>
              )}
            </Menu.Content>
          )}
        </Box>
      </Portal>
    </Menu.Root>
  );
});

function Group({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  // No title → render the items inline without the ItemGroup wrapper so
  // the section header doesn't render an empty stripe. Used for the
  // single-org case where the org context is implicit.
  if (!title) {
    return (
      <VStack gap={0} align="stretch">
        {children}
      </VStack>
    );
  }
  return (
    <Menu.ItemGroup title={title}>
      <VStack gap={0} align="stretch">
        {children}
      </VStack>
    </Menu.ItemGroup>
  );
}

function SwitcherItem({
  entry,
  active,
  onSelect,
}: {
  entry: WorkspaceSwitcherEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = ICON_BY_KIND[entry.kind];
  const itemValue =
    entry.kind === "personal"
      ? "personal"
      : entry.kind === "team"
        ? `team:${entry.teamId}`
        : `project:${entry.projectId}`;

  return (
    <Menu.Item
      value={itemValue}
      fontSize="14px"
      paddingY="5px"
      onClick={onSelect}
      asChild
    >
      <Link
        href={entry.href}
        _hover={{ textDecoration: "none" }}
        onClick={(e) => {
          // Cmd/Ctrl/Shift/Alt + click and middle-click are "open in new
          // tab" gestures — let the browser handle them via the <a href>.
          // Only intercept plain left-click so the menu can close
          // synchronously and onSelect drives the navigation.
          if (
            e.metaKey ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey ||
            e.button === 1
          ) {
            return;
          }
          e.preventDefault();
        }}
      >
        <VStack gap={0} width="full" alignItems="stretch">
          <HStack gap={3} width="full" alignItems="center">
            <Box
              width="20px"
              display="flex"
              justifyContent="center"
              flexShrink={0}
            >
              {entry.kind === "project" ? (
                <ProjectAvatar name={entry.label} />
              ) : (
                <Icon size={14} />
              )}
            </Box>
            <Text
              fontWeight={active ? "semibold" : "normal"}
              truncate
              flex={1}
              minWidth={0}
            >
              {entry.label}
            </Text>
            {active && (
              <Box color="fg.muted" flexShrink={0}>
                <Check size={14} />
              </Box>
            )}
          </HStack>
          {entry.subtitle && (
            <Text fontSize="xs" color="fg.muted" truncate paddingLeft="32px">
              {entry.subtitle}
            </Text>
          )}
        </VStack>
      </Link>
    </Menu.Item>
  );
}

/**
 * Per-team "+" button with a controlled "Create project" tooltip.
 *
 * Tooltip visibility is owned by local state and only flips on pointer
 * enter / leave. Ark Menu auto-moves focus into the dropdown when it
 * opens, which would otherwise trip Zag's focus-opens-tooltip behavior
 * (the underlying machine has no `openOnFocus={false}` knob); passing a
 * no-op `onOpenChange` shorts out Zag's internal open transitions, and
 * the explicit `onFocus` reset is belt-and-braces against any path that
 * still tries to flip us open from focus.
 */
function TeamCreateProjectButton({
  team,
  onCreateProjectForTeam,
  setOpen,
}: {
  team: Extract<WorkspaceSwitcherEntry, { kind: "team" }>;
  onCreateProjectForTeam: NonNullable<
    WorkspaceSwitcherProps["onCreateProjectForTeam"]
  >;
  setOpen: (open: boolean) => void;
}) {
  const [tipOpen, setTipOpen] = React.useState(false);
  return (
    <Tooltip
      content="Create project"
      open={tipOpen}
      onOpenChange={() => {
        /* controlled — ignore Zag's hover / focus transitions */
      }}
    >
      <IconButton
        aria-label={`Create project in ${team.label}`}
        size="xs"
        variant="ghost"
        position="absolute"
        right={2}
        top="50%"
        transform="translateY(-50%)"
        // Out of the menu's focus reach. Ark Menu auto-focuses the first
        // focusable child of Menu.Content on open; since this button sits
        // next to (not inside) a Menu.Item, it competes for that initial
        // focus and ends up with the visible ring on every menu open.
        // tabIndex=-1 takes it out of natural tab order so the menu's
        // initial focus lands on the first Menu.Item (the team link).
        // Click still works; the team page has its own create-project
        // affordance for keyboard-only users.
        tabIndex={-1}
        onMouseEnter={() => setTipOpen(true)}
        onMouseLeave={() => setTipOpen(false)}
        onFocus={() => setTipOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setTipOpen(false);
          setOpen(false);
          onCreateProjectForTeam({
            teamId: team.teamId,
            orgId: team.orgId,
          });
        }}
      >
        <Plus size={14} />
      </IconButton>
    </Tooltip>
  );
}
