/**
 * The Project chip on an Organization board: whose data is on screen, and the organization's
 * projects the reader can open the same board under, one at a time. The project that owns the
 * board is marked, since only there can it be edited.
 * @see modules/dashboard/specs/dashboards-v2.feature AC182
 */

import type { DashboardProject } from "@langwatch/dashboard-contract";
import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, HStack, Text } from "@langwatch/design-system/primitives";
import { ChevronDown } from "lucide-react";

import { PROJECT_CHIP, projectMenuNote } from "../../model/board-scope.ts";

export function BoardProjectChip({
  current,
  ownerProject,
  projects,
  onPick,
}: {
  /** The project whose data the board shows now. */
  current: { id: string; name: string };
  /** The project that owns the board; absent until the list has answered. */
  ownerProject: DashboardProject | undefined;
  /** The projects the reader can open; empty until the list has answered. */
  projects: readonly DashboardProject[];
  onPick: (project: DashboardProject) => void;
}) {
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <Button
          variant="outline"
          size="sm"
          height={8}
          paddingX={2.5}
          gap={1.5}
          borderRadius="lg"
          fontSize="12.5px"
          fontWeight="normal"
          aria-label={`${PROJECT_CHIP.name}: ${current.name}`}
        >
          <Text color="fg.muted">{PROJECT_CHIP.name}</Text>
          <Text fontWeight="medium" truncate maxWidth="180px">
            {current.name}
          </Text>
          <ChevronDown size={12} aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="260px">
        <Menu.RadioItemGroup
          aria-label={PROJECT_CHIP.name}
          value={current.id}
          onValueChange={({ value }) => {
            const picked = projects.find(({ id }) => id === value);
            if (picked && picked.id !== current.id) onPick(picked);
          }}
        >
          <Box paddingX={2} paddingTop={1} paddingBottom={1.5}>
            <Text
              fontSize="9.5px"
              fontWeight="semibold"
              letterSpacing="0.09em"
              textTransform="uppercase"
              color="fg.subtle"
            >
              {PROJECT_CHIP.name}
            </Text>
            <Text fontSize="11.5px" color="fg.muted">
              {PROJECT_CHIP.menuHint}
            </Text>
          </Box>
          {projects.map((project) => (
            <Menu.RadioItem key={project.id} value={project.id} aria-label={project.name}>
              <HStack gap={2}>
                <Text fontSize="12.5px" fontWeight="medium" truncate>
                  {project.name}
                </Text>
                {project.id === ownerProject?.id && (
                  <Text fontSize="11px" color="fg.subtle">
                    {PROJECT_CHIP.ownerTag}
                  </Text>
                )}
              </HStack>
            </Menu.RadioItem>
          ))}
        </Menu.RadioItemGroup>
        {ownerProject && (
          <Text paddingX={2} paddingTop={1.5} paddingBottom={1} fontSize="11px" color="fg.subtle">
            {projectMenuNote({
              owner: ownerProject.name,
              isHere: ownerProject.id === current.id,
              canOpenOwner: projects.some(({ id }) => id === ownerProject.id),
            })}
          </Text>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
