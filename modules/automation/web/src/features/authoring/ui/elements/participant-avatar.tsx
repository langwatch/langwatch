/**
 * Participant avatar: coloured initial from name (mirroring RandomColorAvatar, but no photo).
 */

import { Box } from "@chakra-ui/react";
import { getColorForString } from "@langwatch/design-system/rotating-colors";

export function ParticipantAvatar({ name }: { name: string }) {
  const color = getColorForString("colors", name);
  return (
    <Box
      width="18px"
      height="18px"
      borderRadius="full"
      background={color.background}
      color={color.color}
      fontSize="10px"
      fontWeight="600"
      display="flex"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      aria-hidden="true"
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </Box>
  );
}
