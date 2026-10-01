/**
 * The address that names no page. Moved from `platform/app/src/components/NotFoundScene.tsx`
 * with its canvas renderer.
 */

import { useColorMode, useColorModeValue } from "@langwatch/design-system/color-mode";
import {
  Box,
  Button,
  Center,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SimpleSlider } from "@langwatch/design-system/slider";
import { ArrowLeft, Home, Settings } from "lucide-react";
import { type Dispatch, type SetStateAction, useMemo, useRef, useState } from "react";

import { useNotFoundCanvas } from "../../behavior/use-not-found-canvas.ts";
import { useReducedMotion } from "../../behavior/use-reduced-motion.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import {
  type CanvasColors,
  defaultGridParams,
  type GridParams,
} from "../../model/not-found-canvas-renderer.ts";

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <HStack gap={2} width="100%">
      <Text textStyle="xs" color="fg.muted" width="80px" flexShrink={0}>
        {label}
      </Text>
      <SimpleSlider
        size="sm"
        width="120px"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(e: { value: number[] }) => onChange(e.value[0] ?? value)}
      />
      <Input
        size="xs"
        width="60px"
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </HStack>
  );
}

/** The designer's grid tuning panel, shown only in development. */
function NotFoundDevControls({
  params,
  setParams,
}: {
  params: GridParams;
  setParams: Dispatch<SetStateAction<GridParams>>;
}) {
  const [showControls, setShowControls] = useState(false);
  const updateParam = <K extends keyof GridParams>(key: K, value: GridParams[K]) => {
    setParams((p) => ({ ...p, [key]: value }));
  };

  return (
    <Box
      position="absolute"
      top={2}
      right={2}
      zIndex={10}
      background="bg.panel"
      borderRadius="md"
      padding={showControls ? 3 : 1}
      boxShadow="lg"
      maxHeight="90vh"
      overflowY="auto"
    >
      <Button
        size="xs"
        variant="ghost"
        onClick={() => setShowControls(!showControls)}
        marginBottom={showControls ? 2 : 0}
      >
        <Settings size={14} />
        {showControls ? "Hide" : ""}
      </Button>

      {showControls && (
        <VStack gap={2} align="stretch">
          <ParamSlider
            label="Rotation"
            value={params.rotation}
            min={0}
            max={360}
            step={1}
            onChange={(v) => updateParam("rotation", v)}
          />
          <ParamSlider
            label="Z Offset"
            value={params.zOffset}
            min={100}
            max={15000}
            step={100}
            onChange={(v) => updateParam("zOffset", v)}
          />
          <ParamSlider
            label="FOV Scale"
            value={params.fovScale}
            min={0.1}
            max={3}
            step={0.01}
            onChange={(v) => updateParam("fovScale", v)}
          />
          <ParamSlider
            label="Camera Y"
            value={params.cameraY}
            min={0}
            max={5000}
            step={10}
            onChange={(v) => updateParam("cameraY", v)}
          />
          <ParamSlider
            label="Pitch"
            value={params.pitch}
            min={-90}
            max={90}
            step={1}
            onChange={(v) => updateParam("pitch", v)}
          />
          <ParamSlider
            label="Aberration"
            value={params.aberration}
            min={0}
            max={30}
            step={0.5}
            onChange={(v) => updateParam("aberration", v)}
          />
          <ParamSlider
            label="Grid Size"
            value={params.gridExtent}
            min={500}
            max={10000}
            step={100}
            onChange={(v) => updateParam("gridExtent", v)}
          />
          <ParamSlider
            label="Grid Step"
            value={params.gridStep}
            min={20}
            max={500}
            step={10}
            onChange={(v) => updateParam("gridStep", v)}
          />
          <Button size="xs" variant="outline" onClick={() => setParams(defaultGridParams)}>
            Reset
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              console.log("Grid params:", params);
              void navigator.clipboard
                .writeText(JSON.stringify(params, null, 2))
                .catch((error: unknown) => {
                  console.warn("Copy failed:", error);
                });
            }}
          >
            Copy Params
          </Button>
        </VStack>
      )}
    </Box>
  );
}

export function NotFoundScene() {
  const host = useNavigationHost();
  const { colorMode } = useColorMode();
  const isDevMode = host.deployment().isDevelopment;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const redTextRef = useRef<HTMLDivElement>(null);
  const blueTextRef = useRef<HTMLDivElement>(null);

  const [params, setParams] = useState<GridParams>(defaultGridParams);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const prefersReducedMotion = useReducedMotion();

  const colors = useMemo<CanvasColors>(
    () =>
      colorMode === "dark"
        ? {
            gridBaseColor: [80, 160, 255],
            particleBaseColor: [140, 180, 255],
            aberrationRed: [255, 50, 100],
            aberrationBlue: [50, 120, 255],
            alphaScale: 1,
          }
        : {
            gridBaseColor: [40, 90, 190],
            particleBaseColor: [60, 110, 180],
            aberrationRed: [180, 60, 80],
            aberrationBlue: [60, 90, 190],
            alphaScale: 1,
          },
    [colorMode],
  );
  const textRedColor = useColorModeValue("red.600/70", "red.400/60");
  const textBlueColor = useColorModeValue("blue.600/70", "blue.400/60");
  const textBaseOpacity = useColorModeValue(0.14, 0.08);

  useNotFoundCanvas({
    canvasRef,
    containerRef,
    redTextRef,
    blueTextRef,
    paramsRef,
    colors,
    prefersReducedMotion,
  });

  return (
    <Center
      ref={containerRef}
      width="100%"
      height="100dvh"
      minHeight="400px"
      overflow="hidden"
      position="relative"
      css={{
        "@keyframes glitch-1": {
          "0%, 100%": { clipPath: "inset(0 0 96% 0)" },
          "20%": { clipPath: "inset(20% 0 60% 0)" },
          "40%": { clipPath: "inset(60% 0 10% 0)" },
          "60%": { clipPath: "inset(40% 0 30% 0)" },
          "80%": { clipPath: "inset(80% 0 5% 0)" },
        },
        "@keyframes glitch-2": {
          "0%, 100%": { clipPath: "inset(95% 0 0 0)" },
          "25%": { clipPath: "inset(10% 0 70% 0)" },
          "50%": { clipPath: "inset(50% 0 20% 0)" },
          "75%": { clipPath: "inset(30% 0 50% 0)" },
        },
        "@keyframes drift": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "@keyframes text-glitch": {
          "0%, 92%, 100%": { transform: "none", opacity: 1 },
          "93%": { transform: "translateX(-2px) skewX(-1deg)", opacity: 0.8 },
          "94%": { transform: "translateX(3px) skewX(1deg)", opacity: 0.9 },
          "95%": { transform: "translateX(-1px)", opacity: 0.7 },
          "96%": { transform: "none", opacity: 1 },
        },
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      />

      {isDevMode && <NotFoundDevControls params={params} setParams={setParams} />}

      <VStack gap={6} zIndex={1}>
        <Box
          position="relative"
          userSelect="none"
          css={{
            textShadow: "0 0 60px rgba(100, 160, 255, 0.12), 0 4px 20px rgba(0, 0, 0, 0.25)",
          }}
        >
          <Text
            fontWeight={800}
            fontSize="clamp(7rem, 18vw, 12rem)"
            lineHeight={1}
            letterSpacing="-0.04em"
            color="fg.default"
            opacity={textBaseOpacity}
          >
            404
          </Text>

          <Text
            ref={redTextRef}
            aria-hidden
            position="absolute"
            inset={0}
            fontWeight={800}
            fontSize="clamp(7rem, 18vw, 12rem)"
            lineHeight={1}
            letterSpacing="-0.04em"
            color={textRedColor}
            animation={prefersReducedMotion ? "none" : "glitch-1 3s steps(1) infinite"}
            willChange="transform"
            style={{ transform: "translate(-2px, -1px)" }}
          >
            404
          </Text>
          <Text
            ref={blueTextRef}
            aria-hidden
            position="absolute"
            inset={0}
            fontWeight={800}
            fontSize="clamp(7rem, 18vw, 12rem)"
            lineHeight={1}
            letterSpacing="-0.04em"
            color={textBlueColor}
            animation={prefersReducedMotion ? "none" : "glitch-2 2.5s steps(1) infinite"}
            willChange="transform"
            style={{ transform: "translate(2px, 1px)" }}
          >
            404
          </Text>
        </Box>

        <VStack
          gap={2}
          animation={
            prefersReducedMotion
              ? "none"
              : "drift 4s ease-in-out infinite, text-glitch 6s steps(1) infinite"
          }
        >
          <Text
            textStyle="lg"
            color="fg"
            fontWeight={400}
            textAlign="center"
            css={{ textShadow: "0 1px 12px var(--chakra-colors-bg)" }}
          >
            You've wandered out of the simulation
          </Text>
          <Text
            textStyle="sm"
            color="fg.muted"
            textAlign="center"
            css={{ textShadow: "0 1px 12px var(--chakra-colors-bg)" }}
          >
            This page doesn't exist or has been moved.
          </Text>
        </VStack>

        <HStack gap={3} marginTop={2}>
          <Button size="sm" variant="solid" onClick={() => host.back()}>
            <ArrowLeft size={14} />
            Go back
          </Button>
          <Button size="sm" variant="ghost" color="fg.muted" onClick={() => host.navigate("/")}>
            <Home size={14} />
            Home
          </Button>
        </HStack>
      </VStack>
    </Center>
  );
}
