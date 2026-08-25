import { Box } from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import type React from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { aiBrandPalette } from "../ai/aiBrandPalette";

interface AiShaderBackdropProps {
  /** When true, the mesh animates faster — used as the "thinking" indicator. */
  active?: boolean;
}

/**
 * Two stacked meshes behind the inner panel: a small ambient halo for soft
 * lift, plus a sharp mesh whose 1.5px reveal at the panel's edges reads as
 * a thin moving border. Speeds up when `active`. Goes static under reduced-motion.
 */
export const AiShaderBackdrop: React.FC<AiShaderBackdropProps> = ({ active = false }) => {
  const reduceMotion = useReducedMotion();
  const speed = reduceMotion ? 0 : active ? 1.1 : 0.3;
  return (
    <>
      <Box
        position="absolute"
        top="-3px"
        left="-3px"
        right="-3px"
        bottom="-3px"
        opacity={0.4}
        _dark={{ opacity: 0.22 }}
        filter="blur(8px) saturate(140%)"
        pointerEvents="none"
        zIndex={-1}
      >
        <MeshGradient
          colors={aiBrandPalette}
          distortion={0.4}
          swirl={0.4}
          grainMixer={0}
          grainOverlay={0}
          speed={speed}
          scale={1.3}
          originX={0}
          offsetX={-0.25}
          style={{ width: "100%", height: "100%" }}
        />
      </Box>
      <Box
        position="absolute"
        inset={0}
        borderTopLeftRadius="lg"
        overflow="hidden"
        pointerEvents="none"
        zIndex={0}
        _dark={{ opacity: 0.6 }}
      >
        <MeshGradient
          colors={aiBrandPalette}
          distortion={0.45}
          swirl={0.5}
          grainMixer={0}
          grainOverlay={0}
          speed={speed}
          scale={1.3}
          originX={0}
          offsetX={-0.25}
          style={{ width: "100%", height: "100%" }}
        />
      </Box>
    </>
  );
};
