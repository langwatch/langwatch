// A project on a braid, drawn as the project switcher draws one: its initial on a colour hashed
// from it, so a project looks the same here as everywhere else in the app.

import { Avatar } from "@langwatch/design-system/avatar";
import { firstGrapheme } from "@langwatch/design-system/first-grapheme";
import { HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { getAvatarFillForString } from "@langwatch/design-system/rotating-colors";
import type { ReactNode } from "react";

import type { BraidProject } from "../../model/braids/braids.ts";

export function BraidProjectBadge({
  project,
  size = "md",
}: {
  project: Pick<BraidProject, "name">;
  size?: "sm" | "md";
}) {
  const initial = firstGrapheme(project.name);
  const box = size === "sm" ? "20px" : "24px";
  return (
    <Avatar.Root
      aria-hidden
      size="2xs"
      flexShrink={0}
      color="fg.onColor"
      background={getAvatarFillForString(initial)}
      width={box}
      height={box}
    >
      <Avatar.Fallback>{initial}</Avatar.Fallback>
    </Avatar.Root>
  );
}

export function BraidProjectLabel({
  project,
  detail,
}: {
  project: Pick<BraidProject, "name">;
  detail?: ReactNode;
}) {
  return (
    <HStack gap={2.5} minWidth={0}>
      <BraidProjectBadge project={project} />
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
