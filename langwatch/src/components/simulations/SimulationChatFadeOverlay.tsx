import { Box } from "@chakra-ui/react";

export function SimulationChatFadeOverlay() {
  return (
    <>
      {/* Top fade overlay */}
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        height="30px"
        background="linear-gradient(to bottom, white, transparent)"
        pointerEvents="none"
        zIndex={10}
      />

      {/* Bottom fade overlay */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        height="60px"
        background="linear-gradient(to top, white, transparent)"
        pointerEvents="none"
        zIndex={10}
      />
    </>
  );
}
