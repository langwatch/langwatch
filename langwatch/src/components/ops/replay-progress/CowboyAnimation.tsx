import { useEffect, useRef, useState } from "react";
import { Box } from "@chakra-ui/react";

// -- Cowboy Gunfight Frames (adapted from CLI) --
// Positions: Left figure at col 5, Right figure at col 33
// Each frame is 3 lines of monospace text

function buildFrames(): string[][] {
  const line = (...segments: [number, string][]): string => {
    let out = "";
    let col = 0;
    for (const [targetCol, text] of segments) {
      if (targetCol > col) out += " ".repeat(targetCol - col);
      out += text;
      col = targetCol + text.length;
    }
    return out;
  };

  const L = 5;
  const R = 33;
  const lStand = "/|\\";
  const rStand = "/|\\";
  const lLegs = "/ \\";
  const rLegs = "/ \\";
  const lGun = "/|\u2550=";
  const rGun = "=\u2550|\\";
  const dots = "\u00B7   \u00B7   \u00B7   \u00B7";
  const bullet = (n: number) => "\u2500".repeat(n);

  return [
    [
      // 0: Standoff
      line([L, "O"], [13, dots], [R, "O"]),
      line([L - 1, lStand], [R - 1, rStand]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 1: Tumbleweed
      line([L, "O"], [R, "O"]),
      line([L - 1, lStand], [18, "\u00B0"], [R - 1, rStand]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 2: Left draws
      line([L, "O"], [R, "O"]),
      line([L - 1, lGun], [13, dots], [R - 1, rStand]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 3: Left shoots
      line([L, "O"], [R, "O"]),
      line(
        [L - 1, lGun],
        [L + 3, bullet(11) + "\u25B6"],
        [R - 1, rStand],
      ),
      line([L - 1, lLegs], [15, "pew!"], [R - 1, rLegs]),
    ],
    [
      // 4: Bullet hits right
      line([L, "O"], [R - 1, "*"], [R, "O"]),
      line(
        [L - 1, lGun],
        [L + 3, "\u00B7 \u00B7 \u00B7 \u00B7 \u00B7"],
        [R - 1, rStand],
      ),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 5: Right dodges
      line([L, "O"], [R - 1, "\\O"]),
      line(
        [L - 1, lGun],
        [L + 3, "\u00B7   \u00B7   \u00B7"],
        [R, "|"],
      ),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 6: Right draws
      line([L, "O"], [R, "O"]),
      line([L - 1, lStand], [13, dots], [R - 2, rGun]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 7: Right shoots
      line([L, "O"], [R, "O"]),
      line(
        [L - 1, lStand],
        [L + 2, "\u25C0" + bullet(11)],
        [R - 2, rGun],
      ),
      line([L - 1, lLegs], [20, "!wep"], [R - 1, rLegs]),
    ],
    [
      // 8: Bullet hits left
      line([L + 1, "*"], [L, "O"], [R, "O"]),
      line(
        [L - 1, lStand],
        [L + 2, "\u00B7 \u00B7 \u00B7 \u00B7 \u00B7"],
        [R - 2, rGun],
      ),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 9: Left dodges
      line([L, "O/"], [R, "O"]),
      line([L, "|"], [L + 2, "\u00B7   \u00B7   \u00B7"], [R - 2, rGun]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 10: Both draw
      line([L, "O"], [19, "\u00B7"], [R, "O"]),
      line([L - 1, lGun], [13, dots], [R - 2, rGun]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 11: Both shoot
      line([L, "O"], [R, "O"]),
      line(
        [L - 1, lGun],
        [L + 3, bullet(4) + "\u25B6"],
        [18, "\u2736"],
        [20, "\u25C0" + bullet(4)],
        [R - 2, rGun],
      ),
      line([L - 1, lLegs], [13, "pew! !wep"], [R - 1, rLegs]),
    ],
    [
      // 12: Explosion
      line([L, "O"], [15, "\\"], [17, "*"], [19, "|"], [21, "*"], [23, "/"], [R, "O"]),
      line(
        [L - 1, lGun],
        [13, bullet(2)],
        [16, "\u2605"],
        [18, "\u2605"],
        [20, "\u2605"],
        [23, bullet(2)],
        [R - 2, rGun],
      ),
      line(
        [L - 1, lLegs],
        [15, "/"],
        [17, "*"],
        [19, "|"],
        [21, "*"],
        [23, "\\"],
        [R - 1, rLegs],
      ),
    ],
    [
      // 13: Smoke
      line([L, "O"], [12, "~  ~  ~  ~  ~"], [R, "O"]),
      line([L - 1, lStand], [11, "~  ~  ~  ~  ~  ~"], [R - 1, rStand]),
      line([L - 1, lLegs], [12, "~  ~  ~  ~  ~"], [R - 1, rLegs]),
    ],
  ];
}

const FRAMES = buildFrames();

function getFrameForPhase(
  phase: string | null,
  tick: number,
): string[] {
  if (phase === "replay") {
    const seq = [3, 4, 5, 6, 7, 8, 9, 10, 11];
    const idx = Math.floor(tick / 3) % seq.length;
    return FRAMES[seq[idx]!]!;
  }
  if (phase === "write") {
    const seq = [11, 12, 12, 13, 13];
    const idx = Math.floor(tick / 3) % seq.length;
    return FRAMES[seq[idx]!]!;
  }
  if (phase === "drain") {
    const seq = [0, 0, 1, 0, 0];
    const idx = Math.floor(tick / 4) % seq.length;
    return FRAMES[seq[idx]!]!;
  }
  if (phase === "cutoff") {
    const seq = [0, 2, 6, 10];
    const idx = Math.floor(tick / 4) % seq.length;
    return FRAMES[seq[idx]!]!;
  }
  // Default: calm standoff
  return FRAMES[0]!;
}

export function CowboyAnimation({ phase }: { phase: string | null }) {
  const [tick, setTick] = useState(0);
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const frame = getFrameForPhase(phase, tick);

  return (
    <Box
      fontFamily="mono"
      fontSize="14px"
      lineHeight="1.3"
      whiteSpace="pre"
      textAlign="center"
      color="orange.400"
      userSelect="none"
    >
      {frame.map((line, i) => (
        <Box key={i}>{line}</Box>
      ))}
    </Box>
  );
}
