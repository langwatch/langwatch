import { Box } from "@chakra-ui/react";
import { useColorModeValue } from "../ui/color-mode";

export function SimulationChatFadeOverlay() {
  const bgColor = useColorModeValue("white", "#09090b");

  return (
    <>
      {/* Top fade overlay */}
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        height="30px"
        background={`linear-gradient(to bottom, ${bgColor}, transparent)`}
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
        background={`linear-gradient(to top, ${bgColor}, transparent)`}
        pointerEvents="none"
        zIndex={10}
      />
    </>
  );
}
