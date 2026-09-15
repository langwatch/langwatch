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
      background: [
        "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(237,137,38,0.06) 0%, transparent 70%)",
        "radial-gradient(ellipse 60% 40% at 70% 100%, rgba(237,137,38,0.02) 0%, transparent 60%)",
      ].join(", "),
    }}
  />
);

export default OnboardingMeshBackground;
