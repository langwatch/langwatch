import { Box } from "@chakra-ui/react";
import type React from "react";

export const OnboardingMeshBackground: React.FC = () => (
  <Box
    position="absolute"
    inset={0}
    pointerEvents="none"
    overflow="hidden"
    zIndex={0}
    style={{
      contain: "layout paint",
      background:
        "linear-gradient(180deg, rgba(237,137,38,0.09) 0%, rgba(237,137,38,0.03) 35%, transparent 60%)",
    }}
  />
);

export default OnboardingMeshBackground;
