import { Box } from "@langwatch/design-system/primitives";
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
              "radial-gradient(ellipse 70% 55% at 30% 20%, color-mix(in srgb, var(--chakra-colors-orange-subtle) 90%, transparent) 0%, transparent 70%)",
              "radial-gradient(ellipse 60% 50% at 80% 80%, color-mix(in srgb, var(--chakra-colors-orange-muted) 75%, transparent) 0%, transparent 65%)",
              "radial-gradient(ellipse 50% 40% at 70% 10%, color-mix(in srgb, var(--chakra-colors-accent-solid) 10%, transparent) 0%, transparent 60%)",
            ].join(", ")
          : [
              "radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in srgb, var(--chakra-colors-accent-solid) 6%, transparent) 0%, transparent 70%)",
              "radial-gradient(ellipse 60% 40% at 70% 100%, color-mix(in srgb, var(--chakra-colors-accent-solid) 2%, transparent) 0%, transparent 60%)",
            ].join(", "),
      }}
    />
  );
};

export default OnboardingMeshBackground;
