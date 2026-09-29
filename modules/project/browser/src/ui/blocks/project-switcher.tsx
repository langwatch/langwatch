/**
 * Project's lent switcher (ARCHITECTURE §10), ported from main's
 * `ProjectSelector`: the current project as a ghost button, and a menu of
 * every project grouped by organization and team, as the graph arrives.
 */

import { Button, HStack, Text } from "@chakra-ui/react";
import { useUiCapabilities, useUiScope } from "@langwatch/browser-host/capabilities";
import { Link } from "@langwatch/browser-host/link";
import { Menu } from "@langwatch/design-system/menu";
import { ChevronDown } from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";

import { api } from "../../behavior/project-api.ts";
import { projectSwitchGroups, projectSwitchHref } from "../../model/project-switch.ts";
import { ProjectAvatar } from "../elements/project-avatar.tsx";

export default function ProjectSwitcher() {
  const { navigation, route } = useUiCapabilities();
  const { projectId } = useUiScope().activeScope();
  const [isOpen, setIsOpen] = useState(false);
  const organizations = api.organization.getAll.useQuery({ isDemo: false });

  const groups = useMemo(() => projectSwitchGroups(organizations.data ?? []), [organizations.data]);
  const current = groups
    .flatMap((group) => group.projects)
    .find((project) => project.id === projectId);

  if (!current) return null;

  const pathname = route.reading().pathname ?? "";
  const follow = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    const isModifiedClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (isModifiedClick || event.button !== 0) return;
    event.preventDefault();
    setIsOpen(false);
    navigation.navigate(href);
  };

  return (
    <Menu.Root open={isOpen} onOpenChange={({ open }) => setIsOpen(open)}>
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
          _hover={{ backgroundColor: "bg.muted" }}
        >
          <HStack gap={2}>
            <ProjectAvatar name={current.name} />
            <Text>{current.name}</Text>
            <ChevronDown size={14} />
          </HStack>
        </Button>
      </Menu.Trigger>
      {isOpen && (
        <Menu.Content>
          {groups.map((group) => (
            <Menu.ItemGroup key={group.key} title={group.title}>
              {group.projects.map((project) => {
                const href = projectSwitchHref({
                  pathname,
                  currentProjectSlug: current.slug,
                  targetSlug: project.slug,
                });
                return (
                  <Menu.Item key={project.id} value={project.id} fontSize="14px" asChild>
                    <Link href={href} onClick={follow(href)} _hover={{ textDecoration: "none" }}>
                      <HStack gap={2}>
                        <ProjectAvatar name={project.name} />
                        <Text>{project.name}</Text>
                      </HStack>
                    </Link>
                  </Menu.Item>
                );
              })}
            </Menu.ItemGroup>
          ))}
        </Menu.Content>
      )}
    </Menu.Root>
  );
}
