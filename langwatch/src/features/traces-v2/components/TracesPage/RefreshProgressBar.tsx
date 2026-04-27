import { Box } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useFreshnessSignal } from "../../stores/freshnessSignal";

const SWEEP_DURATION_MS = 2800;

export const RefreshProgressBar: React.FC = () => {
  const isRefreshing = useFreshnessSignal((s) => s.isRefreshing);
  const [sweepKey, setSweepKey] = useState(0);
  const [active, setActive] = useState(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    refreshingRef.current = isRefreshing;
    if (isRefreshing && !active) {
      setActive(true);
      setSweepKey((k) => k + 1);
    }
  }, [isRefreshing, active]);

  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.animationName !== "tracesV2Reveal") return;
    if (refreshingRef.current) {
      setSweepKey((k) => k + 1);
    } else {
      setActive(false);
    }
  };

  if (!active) return null;

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      right={0}
      height="90px"
      pointerEvents="none"
      zIndex={3}
      overflow="hidden"
      aria-hidden="true"
      css={{
        maskImage:
          "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.7) 45%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.7) 45%, transparent 100%)",
      }}
    >
      <Box
        key={sweepKey}
        position="absolute"
        inset={0}
        onAnimationEnd={handleAnimationEnd}
        css={{
          animation: `tracesV2Reveal ${SWEEP_DURATION_MS}ms ease-in-out`,
          "@keyframes tracesV2Reveal": {
            "0%": { clipPath: "inset(0 100% 0 0)" },
            "100%": { clipPath: "inset(0 -2% 0 0)" },
          },
        }}
      >
        <Box
          position="absolute"
          top="-130px"
          left="-8%"
          width="42%"
          height="240px"
          bg="blue.400"
          opacity={0.55}
          css={{
            filter: "blur(80px)",
            animation: "tracesV2OrbA 3.4s ease-in-out infinite alternate",
            "@keyframes tracesV2OrbA": {
              "0%": {
                borderRadius: "60% 40% 55% 45% / 55% 60% 40% 45%",
                transform: "scale(0.95) translate(-1%, -6px)",
              },
              "100%": {
                borderRadius: "40% 60% 45% 55% / 50% 40% 60% 50%",
                transform: "scale(1.1) translate(2%, 10px)",
              },
            },
          }}
        />
        <Box
          position="absolute"
          top="-140px"
          left="18%"
          width="44%"
          height="250px"
          bg="blue.500"
          opacity={0.5}
          css={{
            filter: "blur(96px)",
            animation:
              "tracesV2OrbB 2.8s ease-in-out infinite alternate-reverse",
            "@keyframes tracesV2OrbB": {
              "0%": {
                borderRadius: "70% 30% 40% 60% / 50% 60% 40% 50%",
                transform: "scale(1.08) translate(-2%, 8px)",
              },
              "100%": {
                borderRadius: "35% 65% 60% 40% / 60% 40% 50% 50%",
                transform: "scale(0.96) translate(3%, -8px)",
              },
            },
          }}
        />
        <Box
          position="absolute"
          top="-135px"
          left="44%"
          width="44%"
          height="245px"
          bg="blue.400"
          opacity={0.5}
          css={{
            filter: "blur(88px)",
            animation: "tracesV2OrbC 3.8s ease-in-out infinite alternate",
            "@keyframes tracesV2OrbC": {
              "0%": {
                borderRadius: "50% 50% 60% 40% / 45% 55% 55% 45%",
                transform: "scale(1.06) translate(2%, -6px)",
              },
              "100%": {
                borderRadius: "60% 40% 35% 65% / 55% 45% 50% 55%",
                transform: "scale(0.94) translate(-2%, 12px)",
              },
            },
          }}
        />
        <Box
          position="absolute"
          top="-130px"
          left="68%"
          width="42%"
          height="240px"
          bg="blue.300"
          opacity={0.5}
          css={{
            filter: "blur(82px)",
            animation:
              "tracesV2OrbD 3.2s ease-in-out infinite alternate-reverse",
            "@keyframes tracesV2OrbD": {
              "0%": {
                borderRadius: "55% 45% 50% 50% / 50% 60% 40% 50%",
                transform: "scale(0.96) translate(-2%, 6px)",
              },
              "100%": {
                borderRadius: "45% 55% 60% 40% / 60% 40% 60% 40%",
                transform: "scale(1.12) translate(2%, -10px)",
              },
            },
          }}
        />
      </Box>
    </Box>
  );
};
