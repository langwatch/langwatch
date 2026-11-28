// A project on a braid, drawn with the one ProjectAvatar, so a project looks the same here as
// everywhere else in the app.

import { HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { ProjectAvatar } from "@langwatch/design-system/project-avatar";
import type { ReactNode } from "react";

import type { BraidProject } from "../../model/braids/braids.ts";

export function BraidProjectLabel({
  project,
  detail,
}: {
  project: Pick<BraidProject, "name">;
  detail?: ReactNode;
}) {
  return (
    <HStack gap={2.5} minWidth={0}>
      <ProjectAvatar name={project.name} size="md" />
      <Stack gap={0} minWidth={0}>
        <Text textStyle="sm" fontWeight="medium" truncate>
          {project.name}
        </Text>
        {detail ? (
          <Text textStyle="xs" color="fg.muted" truncate>
            {detail}
          </Text>
        ) : null}
      </Stack>
    </HStack>
  );
}
