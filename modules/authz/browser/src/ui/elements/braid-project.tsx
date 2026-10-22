// A project on a braid: its strand colour paired with initials, so colour is never the only cue.

import { Box, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import type { BraidProject } from "../../model/braids/braids.ts";

export function BraidProjectBadge({
  project,
  size = "md",
}: {
  project: BraidProject;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "22px" : "28px";
  return (
    <Box
      aria-hidden
      flexShrink={0}
      display="inline-grid"
      placeItems="center"
      width={box}
      height={box}
      borderRadius="md"
      bg={`feature.braids.project.${project.strand}`}
      color={`feature.braids.projectInk.${project.strand}`}
      fontSize={size === "sm" ? "2xs" : "xs"}
      fontWeight="semibold"
      data-strand={project.strand}
    >
      {project.initials}
    </Box>
  );
}

export function BraidProjectLabel({
  project,
  detail,
}: {
  project: BraidProject;
  detail?: ReactNode;
}) {
  return (
    <HStack gap={3} minWidth={0}>
      <BraidProjectBadge project={project} />
      <Stack gap={0} minWidth={0}>
        <Text fontWeight="medium" truncate>
          {project.name}
        </Text>
        {detail ? (
          <Text fontSize="xs" color="fg.muted" truncate>
            {detail}
          </Text>
        ) : null}
      </Stack>
    </HStack>
  );
}
