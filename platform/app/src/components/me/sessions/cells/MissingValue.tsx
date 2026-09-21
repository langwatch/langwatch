import { Text } from "@chakra-ui/react";
import type React from "react";

/** The placeholder character for a value a row does not have. */
export const MISSING_VALUE = "—";

/**
 * What a cell shows when the session never reported the figure it holds. Every
 * such cell renders the same muted placeholder, so a gap in the data reads as
 * a gap rather than as a zero the reader has to interpret.
 */
export const MissingValue: React.FC = () => (
  <Text fontSize="sm" color="fg.subtle">
    {MISSING_VALUE}
  </Text>
);
