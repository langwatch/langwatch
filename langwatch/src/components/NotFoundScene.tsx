import {
  Box,
  Button,
  Center,
  HStack,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft, Home, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useColorModeValue } from "~/components/ui/color-mode";
import { SimpleSlider } from "~/components/ui/slider";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useRouter } from "~/utils/compat/next-router";
import {
  createNotFoundRenderer,
  defaultGridParams,
  MAX_CANVAS_DPR,
  type CanvasColors,
  type GridParams,
} from "./notFoundCanvasRenderer";

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
        onValueChange={(e: { value: number[] }) =>
          onChange(e.value[0] ?? value)
        }
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

export function NotFoundScene() {
  const router = useRouter();
  const isDevMode = process.env.NODE_ENV === "development";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const redTextRef = useRef<HTMLDivElement>(null);
  const blueTextRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const mouse = useRef({ x: 0, y: 0 });
  const smoothMouse = useRef({ x: 0, y: 0 });
  const rendererRef = useRef(createNotFoundRenderer());

  const [showControls, setShowControls] = useState(false);
  const [params, setParams] = useState<GridParams>(defaultGridParams);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const prefersReducedMotion = useReducedMotion();
  const isVisible = useRef(true);
  const isTabActive = useRef(true);

  const updateParam = <K extends keyof GridParams>(
    key: K,
    value: GridParams[K],
  ) => {
    setParams((p) => ({ ...p, [key]: value }));
  };

  const gridBaseColor: [number, number, number] = useColorModeValue(
    [40, 90, 190],
    [80, 160, 255],
  );
  const particleBaseColor: [number, number, number] = useColorModeValue(
    [60, 110, 180],
    [140, 180, 255],
  );
  const aberrationRed: [number, number, number] = useColorModeValue(
    [180, 60, 80],
    [255, 50, 100],
  );
  const aberrationBlue: [number, number, number] = useColorModeValue(
    [60, 90, 190],
    [50, 120, 255],
  );
  const alphaScale = useColorModeValue(1, 1);
  const textRedColor = useColorModeValue("red.600/70", "red.400/60");
  const textBlueColor = useColorModeValue("blue.600/70", "blue.400/60");
  const textBaseOpacity = useColorModeValue(0.14, 0.08);

  const onMove = useCallback((e: MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    mouse.current.x = Math.max(-0.5, Math.min(0.5, (e.clientX - r.left) / r.width - 0.5));
    mouse.current.y = Math.max(-0.5, Math.min(0.5, (e.clientY - r.top) / r.height - 0.5));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    container.addEventListener("mousemove", onMove);

    const colors: CanvasColors = {
      gridBaseColor,
      particleBaseColor,
      aberrationRed,
      aberrationBlue,
      alphaScale,
    };

    const render = rendererRef.current;

    const sizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
      const w = rect.width;
      const h = rect.height;

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      return { w, h, dpr };
    };

    // Reduced motion: render a single static frame, no animation loop
    if (prefersReducedMotion) {
      const { w, h, dpr } = sizeCanvas();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render({
        ctx,
        width: w,
        height: h,
        timestamp: 0,
        params: paramsRef.current,
        colors,
        smoothMouse: { x: 0, y: 0 },
      });
      return () => {
        container.removeEventListener("mousemove", onMove);
      };
    }

    // Pause when tab is hidden
    const onVisibilityChange = () => {
      isTabActive.current = !document.hidden;
      if (!document.hidden && raf.current === 0) {
        raf.current = requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Pause when scrolled out of view
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible.current = entry?.isIntersecting ?? true;
        if (entry?.isIntersecting && raf.current === 0) {
          raf.current = requestAnimationFrame(loop);
        }
      },
      { threshold: 0 },
    );
    observer.observe(container);

    const loop = (timestamp: number) => {
      raf.current = 0;

      if (!isVisible.current || !isTabActive.current) return;

      const { w, h, dpr } = sizeCanvas();

      smoothMouse.current.x += (mouse.current.x - smoothMouse.current.x) * 0.06;
      smoothMouse.current.y += (mouse.current.y - smoothMouse.current.y) * 0.06;

      const textDx = smoothMouse.current.x * 10;
      const textDy = smoothMouse.current.y * 5;
      if (redTextRef.current) {
        redTextRef.current.style.transform = `translate(${-2 - textDx}px, ${-1 - textDy}px)`;
      }
      if (blueTextRef.current) {
        blueTextRef.current.style.transform = `translate(${2 + textDx}px, ${1 + textDy}px)`;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      render({
        ctx,
        width: w,
        height: h,
        timestamp,
        params: paramsRef.current,
        colors,
        smoothMouse: smoothMouse.current,
      });

      raf.current = requestAnimationFrame(loop);
    };

    raf.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      container.removeEventListener("mousemove", onMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer.disconnect();
    };
  }, [onMove, gridBaseColor, particleBaseColor, aberrationRed, aberrationBlue, alphaScale, prefersReducedMotion]);

  return (
    <Center
      ref={containerRef}
      width="100%"
      height="100%"
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

      {isDevMode && (
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
              <Button
                size="xs"
                variant="outline"
                onClick={() => setParams(defaultGridParams)}
              >
                Reset
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  console.log("Grid params:", params);
                  navigator.clipboard.writeText(
                    JSON.stringify(params, null, 2),
                  );
                }}
              >
                Copy Params
              </Button>
            </VStack>
          )}
        </Box>
      )}

      <VStack gap={6} zIndex={1}>
        <Box
          position="relative"
          userSelect="none"
          css={{
            textShadow:
              "0 0 60px rgba(100, 160, 255, 0.12), 0 4px 20px rgba(0, 0, 0, 0.25)",
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
          animation={prefersReducedMotion ? "none" : "drift 4s ease-in-out infinite, text-glitch 6s steps(1) infinite"}
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
          <Button size="sm" variant="solid" onClick={() => router.back()}>
            <ArrowLeft size={14} />
            Go back
          </Button>
          <Button
            size="sm"
            variant="ghost"
            color="fg.muted"
            onClick={() => void router.push("/")}
          >
            <Home size={14} />
            Home
          </Button>
        </HStack>
      </VStack>
    </Center>
  );
}
