import {
  Box,
  Button,
  HStack,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, ChevronDown, Folder, User, Users } from "lucide-react";
import React, { useState } from "react";
import { useRouter } from "~/utils/compat/next-router";

import { Menu } from "./ui/menu";
import { Link } from "./ui/link";
import { ProjectAvatar } from "./ProjectAvatar";

import { useWorkspaceCurrent } from "./useWorkspaceCurrent";

// Public shape consumed by the switcher. Keeping this minimal lets the
// caller source from anywhere — the Sergey tRPC `user.personalContext` once
// it lands, or the existing `useOrganizationTeamProject` shaped to fit.
export type WorkspaceSwitcherEntry =
  | { kind: "personal"; href: string; label: string; subtitle: string }
  | {
      kind: "team";
      teamId: string;
      teamSlug: string;
      href: string;
      label: string;
      subtitle: string;
    }
  | {
      kind: "project";
      projectId: string;
      projectSlug: string;
      href: string;
      label: string;
      subtitle: string;
    };

export type WorkspaceSwitcherCurrent =
  | { kind: "personal" }
  | { kind: "team"; teamId: string }
  | { kind: "project"; projectId: string }
  | { kind: "unknown" };

export type WorkspaceSwitcherProps = {
  personal: Extract<WorkspaceSwitcherEntry, { kind: "personal" }>;
  teams: Array<Extract<WorkspaceSwitcherEntry, { kind: "team" }>>;
  projects: Array<Extract<WorkspaceSwitcherEntry, { kind: "project" }>>;
  /**
   * Currently-selected context. When omitted, the switcher derives it from
   * the router pathname + the user's resolved org/team/project context via
   * `useWorkspaceCurrent`. Pass an explicit value only when overriding the
   * URL-driven selection (e.g. tests, programmatic preview cards).
   */
  current?: WorkspaceSwitcherCurrent;
};

const ICON_BY_KIND = {
  personal: User,
  team: Users,
  project: Folder,
} as const;

function entryIsCurrent(
  entry: WorkspaceSwitcherEntry,
  current: WorkspaceSwitcherCurrent,
): boolean {
  if (entry.kind === "personal") return current.kind === "personal";
  if (entry.kind === "team") {
    return current.kind === "team" && current.teamId === entry.teamId;
  }
  return (
    current.kind === "project" && current.projectId === entry.projectId
  );
}

function currentLabel(
  current: WorkspaceSwitcherCurrent,
  personal: WorkspaceSwitcherProps["personal"],
  teams: WorkspaceSwitcherProps["teams"],
  projects: WorkspaceSwitcherProps["projects"],
): { label: string; kind: keyof typeof ICON_BY_KIND } {
  if (current.kind === "personal") {
    return { label: personal.label, kind: "personal" };
  }
  if (current.kind === "team") {
    const t = teams.find((t) => t.teamId === current.teamId);
    return { label: t?.label ?? "Team", kind: "team" };
  }
  if (current.kind === "project") {
    const p = projects.find((p) => p.projectId === current.projectId);
    return { label: p?.label ?? "Project", kind: "project" };
  }
  return { label: "Choose workspace", kind: "personal" };
}

/**
 * Top-left workspace context switcher. Three groups, in order:
 *   1. My Workspace (always present, always first)
 *   2. Teams (the user's team memberships, alpha-sorted)
 *   3. Projects (the user's project access, alpha-sorted)
 *
 * Consumes data via props so it can mount in any layout (DashboardLayout,
 * MyLayout, future SettingsLayout) without coupling to a specific data hook.
 *
 * Spec: specs/ai-gateway/governance/workspace-switcher.feature
 */
export const WorkspaceSwitcher = React.memo(function WorkspaceSwitcher({
  personal,
  teams,
  projects,
  current: currentProp,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const derivedCurrent = useWorkspaceCurrent({ teams, projects });
  const current = currentProp ?? derivedCurrent;

  const { label: triggerLabel, kind: triggerKind } = currentLabel(
    current,
    personal,
    teams,
    projects,
  );
  const TriggerIcon = ICON_BY_KIND[triggerKind];
  // For project context, render the colored ProjectAvatar in the trigger to
  // preserve parity with the legacy ProjectSelector — projects are visually
  // identified by their team-color bubble across the rest of the app.
  const triggerProjectName =
    triggerKind === "project" ? triggerLabel : null;

  const hasMore = teams.length > 0 || projects.length > 0;

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
              <Group title="My Workspace">
                <SwitcherItem
                  entry={personal}
                  active={entryIsCurrent(personal, current)}
                  onSelect={() => {
                    setOpen(false);
                    void router.push(personal.href);
                  }}
                />
              </Group>

              {teams.length > 0 && (
                <Group title="Teams">
                  {teams.map((team) => (
                    <SwitcherItem
                      key={team.teamId}
                      entry={team}
                      active={entryIsCurrent(team, current)}
                      onSelect={() => {
                        setOpen(false);
                        void router.push(team.href);
                      }}
                    />
                  ))}
                </Group>
              )}

              {projects.length > 0 && (
                <Group title="Projects">
                  {projects.map((project) => (
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
  title: string;
  children: React.ReactNode;
}) {
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
        <HStack gap={3} width="full" alignItems="start" paddingY={1}>
          <Box paddingTop="2px">
            <Icon size={14} />
          </Box>
          <VStack gap={0} alignItems="start" flex={1} minWidth={0}>
            <HStack gap={2} width="full">
              <Text
                fontWeight={active ? "semibold" : "normal"}
                truncate
              >
                {entry.label}
              </Text>
              {active && (
                <Box marginLeft="auto" color="fg.muted">
                  <Check size={14} />
                </Box>
              )}
            </HStack>
            <Text fontSize="xs" color="fg.muted" truncate>
              {entry.subtitle}
            </Text>
          </VStack>
        </HStack>
      </Link>
    </Menu.Item>
  );
}
