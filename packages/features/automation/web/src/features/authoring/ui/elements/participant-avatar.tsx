/**
 * One annotator, as a coloured initial.
 *
 * The application's `RandomColorAvatar` renders the member's uploaded photo
 * when there is one and this letter otherwise; the organization read this
 * family makes does not carry the photo, so the letter is the whole answer here
 * and the colour is derived the same way — from the name, so the same person is
 * the same colour on every render.
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
