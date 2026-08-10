import { Box, Text } from "@chakra-ui/react";
import type { ConnectionTestState } from "../../hooks/connectionTestState";

/**
 * What the last credential check said.
 *
 * Three states, rendered three different ways on purpose. A check that could
 * not run reads as neutral rather than green: it is not a pass, and dressing
 * it as one would tell a customer their configuration is fine on the strength
 * of never having asked.
 *
 * The whole verdict lives in a polite live region. The text arrives well after
 * the click that asked for it, and a screen reader announces neither the
 * "Testing…" transition nor the answer replacing it — so without this the
 * control is a button that appears to do nothing at all.
 *
 * Shared by the provider list and the drawer. The wording of an unchecked
 * verdict differs between them, but that is decided before it arrives here:
 * this renders a message, it does not choose one.
 */
export function ConnectionTestVerdict({
  state,
}: {
  state: ConnectionTestState | undefined;
}) {
  const verdict = () => {
    if (!state) return null;

    if (state.status === "testing") {
      return (
        <Text fontSize="xs" color="fg.muted">
          Testing…
        </Text>
      );
    }

    if (state.status === "works") {
      return (
        <Text fontSize="xs" color="green.fg">
          Connection works
        </Text>
      );
    }

    return (
      <Text
        fontSize="xs"
        color={state.status === "refused" ? "red.fg" : "fg.muted"}
      >
        {state.message}
      </Text>
    );
  };

  return (
    <Box aria-live="polite" aria-atomic="true">
      {verdict()}
    </Box>
  );
}
