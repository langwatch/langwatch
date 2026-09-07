import { Box } from "@chakra-ui/react";
import type React from "react";

/**
 * The soft glow behind the onboarding cards. The takeover screens of the
 * guided variant turn it up: Langy has the whole screen and no card, so the
 * glow is what gives the page its warmth.
 */
export const OnboardingMeshBackground: React.FC<{
  intensity?: "default" | "takeover";
}> = ({ intensity = "default" }) => {
  const takeover = intensity === "takeover";
  return (
    <Box
      position="absolute"
      inset={0}
      pointerEvents="none"
      overflow="hidden"
      zIndex={0}
      transition="opacity 1s ease"
      style={{
        contain: "layout paint",
        background: takeover
          ? [
              "radial-gradient(ellipse 70% 55% at 30% 20%, rgba(255,232,204,0.9) 0%, transparent 70%)",
              "radial-gradient(ellipse 60% 50% at 80% 80%, rgba(253,214,166,0.75) 0%, transparent 65%)",
              "radial-gradient(ellipse 50% 40% at 70% 10%, rgba(237,137,38,0.10) 0%, transparent 60%)",
            ].join(", ")
          : [
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(237,137,38,0.06) 0%, transparent 70%)",
              "radial-gradient(ellipse 60% 40% at 70% 100%, rgba(237,137,38,0.02) 0%, transparent 60%)",
            ].join(", "),
      }}
    />
  );
};

export default OnboardingMeshBackground;
