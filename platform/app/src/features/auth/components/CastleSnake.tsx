import { Box, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { MONO_FONT } from "../authTheme";
import type { Direction, SnakeGame } from "../logic/castleSnake";
import {
  advance,
  advanceChaser,
  createGame,
  queueTurn,
} from "../logic/castleSnake";

/**
 * Double-tap the castle and a snake comes out of it.
 *
 * It runs along the lines of the ground's own signal grid — the 72px lattice
 * `lw-auth-signal-grid` already draws — eating tokens, pursued by a
 * small and unwell molecule. Escape puts it away.
 *
 * ── The rules it plays by ───────────────────────────────────────────────────
 * It is an easter egg on a page where people are trying to log in, so it is
 * built to be impossible to trip over:
 *
 *   - **It cannot block the card.** The canvas is `position: fixed` with
 *     `pointer-events: none`, so it takes no clicks and, being out of flow,
 *     can never reflow anything. Every pixel the card owns stays the card's.
 *   - **It cannot start by accident.** A double-tap on the wordmark is the
 *     only way in. Nothing hints at it, and nothing else on the page listens.
 *   - **It rides the flag.** `AuthShell` mounts it, so it exists exactly
 *     where the D13 screens exist and nowhere else.
 *   - **It takes only the keys it uses.** The arrows and Escape, while a game
 *     is actually running. Typing is untouched.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * This is the one thing on the auth screens that moves under
 * `prefers-reduced-motion: reduce`, and that is deliberate, not an oversight.
 * The setting asks not to be moved at by a page; it does not ask for a game
 * that somebody just deliberately started to sit still. Everything ambient —
 * the entrance, the warp, the rise — stays stood down exactly as before.
 * Please do not "fix" this by gating it.
 *
 * Spec: specs/identity/auth-screen-castle-snake.feature
 */

/** The pitch of the ground's signal grid. Change one, change the other. */
const CELL = 72;

/** Slow enough to be watched, fast enough to still be a game. */
const TICK_MS = 160;

/** The molecule moves at a third of the pace. That is the difficulty. */
const CHASER_EVERY = 3;

/** Where the double-tap is heard. Both auth-screen layouts mark their mark. */
const CASTLE = '[data-auth-card-logo], [data-testid="auth-screen-panel-logo"]';

const KEYS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const ENDINGS: Record<NonNullable<SnakeGame["ending"]>, string> = {
  "eaten-by-the-molecule": "The molecule got you",
  "ate-itself": "You got you",
};

const latticeSize = () => ({
  cols: Math.max(4, Math.ceil(window.innerWidth / CELL) + 1),
  rows: Math.max(4, Math.ceil(window.innerHeight / CELL) + 1),
});

export function CastleSnake() {
  const [playing, setPlaying] = useState(false);
  // Mirrors just enough of the game for the HUD. The game itself lives in a
  // ref: it ticks eight times a second and React has no business re-rendering
  // for any of it.
  const [hud, setHud] = useState<{ eaten: number; ending: string | null }>({
    eaten: 0,
    ending: null,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<SnakeGame | null>(null);

  const stop = useCallback(() => {
    gameRef.current = null;
    setPlaying(false);
    setHud({ eaten: 0, ending: null });
  }, []);

  /** The way in: a deliberate double-tap on the castle, and nothing else. */
  useEffect(() => {
    const onDoubleClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.(CASTLE)) return;

      const { cols, rows } = latticeSize();
      gameRef.current = createGame({ cols, rows, random: Math.random });
      setHud({ eaten: 0, ending: null });
      setPlaying(true);
    };

    document.addEventListener("dblclick", onDoubleClick);
    return () => document.removeEventListener("dblclick", onDoubleClick);
  }, []);

  useKeyboard({ playing, gameRef, stop });
  useGameLoop({ playing, gameRef, canvasRef, setHud });

  if (!playing) return null;

  return (
    <>
      <Box
        as="canvas"
        ref={canvasRef}
        aria-hidden
        position="fixed"
        inset={0}
        zIndex={3}
        // The whole safety argument in one declaration: it cannot take a
        // click, so it cannot come between anybody and the form.
        pointerEvents="none"
        data-testid="castle-snake"
      />
      <Box
        position="fixed"
        left={4}
        bottom={4}
        zIndex={4}
        pointerEvents="none"
        fontFamily={MONO_FONT}
        fontSize="11px"
        letterSpacing="0.08em"
        textTransform="uppercase"
        color="fg.subtle"
        data-testid="castle-snake-hud"
      >
        <Text as="span" color="auth.detail">
          {hud.eaten} tokens
        </Text>
        <Text as="span">
          {hud.ending ? ` · ${hud.ending} · esc` : " · esc to stop"}
        </Text>
      </Box>
    </>
  );
}

/** Arrows steer, Escape puts it away. Nothing else is taken from the page. */
function useKeyboard({
  playing,
  gameRef,
  stop,
}: {
  playing: boolean;
  gameRef: React.RefObject<SnakeGame | null>;
  stop: () => void;
}) {
  useEffect(() => {
    if (!playing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stop();
        return;
      }

      const direction = KEYS[event.key];
      if (!direction || !gameRef.current) return;

      // Only now, and only for these four: an arrow key means "turn" while a
      // game is running, so it must not also scroll the page or walk a
      // cursor through somebody's address.
      event.preventDefault();
      gameRef.current = queueTurn(gameRef.current, direction);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playing, gameRef, stop]);
}

/**
 * What the renderer remembers that the rules do not: where the molecule is
 * gliding FROM, when the last token went down, when the game ended. The rules
 * are node-to-node; everything continuous about the picture lives here.
 */
type Effects = {
  chaserFrom: { x: number; y: number };
  chaserMovedAt: number;
  burst: { x: number; y: number; at: number } | null;
  endedAt: number | null;
};

/** One beat of the world: the snake always, the molecule every third time. */
const beat = ({
  game,
  ticks,
  fx,
  now,
}: {
  game: SnakeGame;
  ticks: number;
  fx: Effects;
  now: number;
}) => {
  const moved = advance(game, Math.random);
  if (moved.eaten > game.eaten) fx.burst = { ...px(game.token), at: now };

  let next = moved;
  if (ticks % CHASER_EVERY === 0) {
    next = advanceChaser(moved);
    if (next.chaser !== moved.chaser) {
      fx.chaserFrom = moved.chaser;
      fx.chaserMovedAt = now;
    }
  }

  if (next.ending && fx.endedAt === null) fx.endedAt = now;
  return next;
};

const hudOf = (game: SnakeGame) => ({
  eaten: game.eaten,
  ending: game.ending ? ENDINGS[game.ending] : null,
});

/** How far between two ticks this frame falls. A finished game holds still. */
const progressOf = (game: SnakeGame, now: number, lastTick: number) =>
  game.ending ? 1 : Math.min(1, (now - lastTick) / TICK_MS);

/** The clock: a fixed tick, drawn every frame with the gap interpolated. */
function useGameLoop({
  playing,
  gameRef,
  canvasRef,
  setHud,
}: {
  playing: boolean;
  gameRef: React.RefObject<SnakeGame | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  setHud: (hud: { eaten: number; ending: string | null }) => void;
}) {
  useEffect(() => {
    if (!playing) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    fit();
    window.addEventListener("resize", fit);

    let frame = 0;
    let ticks = 0;
    let lastTick = performance.now();
    const fx: Effects = {
      chaserFrom: gameRef.current?.chaser ?? { x: 0, y: 0 },
      chaserMovedAt: lastTick,
      burst: null,
      endedAt: null,
    };

    const loop = (now: number) => {
      let game = gameRef.current;

      while (game && !game.ending && now - lastTick >= TICK_MS) {
        lastTick += TICK_MS;
        ticks += 1;
        game = beat({ game, ticks, fx, now });
        gameRef.current = game;
        setHud(hudOf(game));
      }

      if (game)
        paint({
          context,
          game,
          fx,
          now,
          progress: progressOf(game, now, lastTick),
        });

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
  }, [playing, gameRef, canvasRef, setHud]);
}

/** Reads a colour the theme already owns, so the game is never off-palette. */
const themed = (token: string, fallback: string) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    `--chakra-colors-auth-${token}`,
  );
  return value.trim() || fallback;
};

const px = (node: { x: number; y: number }) => ({
  x: node.x * CELL,
  y: node.y * CELL,
});

/** Adjacent on the lattice — so a wrapped step is not drawn as a long dash. */
const adjacent = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

function paint({
  context,
  game,
  fx,
  now,
  progress,
}: {
  context: CanvasRenderingContext2D;
  game: SnakeGame;
  fx: Effects;
  now: number;
  progress: number;
}) {
  const accent = themed("detail", "#f56b1a");
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // The world dims when it is over, so the ending reads on the picture and
  // not only in the HUD line.
  const fade = fx.endedAt ? Math.max(0.3, 1 - (now - fx.endedAt) / 900) : 1;

  paintToken({ context, game, accent, now });
  paintBurst({ context, fx, accent, now });
  paintSnake({ context, game, progress, accent, fade });
  paintMolecule({ context, game, fx, now });
}

function paintToken({
  context,
  game,
  accent,
  now,
}: {
  context: CanvasRenderingContext2D;
  game: SnakeGame;
  accent: string;
  now: number;
}) {
  const at = px(game.token);
  // A slow breath and a ripple that keeps leaving it: something worth
  // crossing the board for, not a dropped pixel.
  const breath = 0.5 + 0.5 * Math.sin(now / 420);
  const ripple = (now % 1600) / 1600;

  context.save();
  context.strokeStyle = accent;
  context.globalAlpha = (1 - ripple) * 0.35;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(at.x, at.y, 6 + ripple * 15, 0, Math.PI * 2);
  context.stroke();

  context.globalAlpha = 1;
  context.fillStyle = accent;
  context.shadowColor = accent;
  context.shadowBlur = 12 + breath * 9;
  context.beginPath();
  context.arc(at.x, at.y, 3.8 + breath * 1.2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** The moment of eating: one ring, out and gone. */
function paintBurst({
  context,
  fx,
  accent,
  now,
}: {
  context: CanvasRenderingContext2D;
  fx: Effects;
  accent: string;
  now: number;
}) {
  if (!fx.burst) return;
  const t = (now - fx.burst.at) / 480;
  if (t >= 1) {
    fx.burst = null;
    return;
  }

  const eased = 1 - (1 - t) * (1 - t);
  context.save();
  context.strokeStyle = accent;
  context.globalAlpha = (1 - t) * 0.5;
  context.lineWidth = 2 - t;
  context.beginPath();
  context.arc(fx.burst.x, fx.burst.y, 5 + eased * 24, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

/**
 * The snake's spine in pixels, head first: the head reaching for the node it
 * is on its way to, the tail retracting across the tick — which is what makes
 * the crawl continuous instead of a series of hops. Split into runs wherever
 * the lattice wrapped, so a crossing is never drawn as a dash across the
 * whole page.
 */
function spineRuns(
  game: SnakeGame,
  progress: number,
): { x: number; y: number }[][] {
  const step = STEP_PIXELS[game.direction];
  const head = px(game.snake[0]!);
  const reaching = {
    x: head.x + step.x * progress,
    y: head.y + step.y * progress,
  };

  const runs: { x: number; y: number }[][] = [[reaching]];
  for (let i = 0; i < game.snake.length; i++) {
    const node = game.snake[i]!;
    const before = i === 0 ? null : game.snake[i - 1]!;
    if (before && !adjacent(before, node)) runs.push([]);
    runs[runs.length - 1]!.push(px(node));
  }

  const last = runs[runs.length - 1]!;
  if (last.length >= 2) {
    const tail = last[last.length - 1]!;
    const beforeTail = last[last.length - 2]!;
    last[last.length - 1] = {
      x: tail.x + (beforeTail.x - tail.x) * progress,
      y: tail.y + (beforeTail.y - tail.y) * progress,
    };
  }

  return runs;
}

/**
 * Trace a run with its corners rounded: each interior node becomes a small
 * curve rather than a right angle, which is most of what "smooth" means at
 * this size.
 */
function traceRounded(
  context: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
) {
  if (points.length < 2) return;
  context.moveTo(points[0]!.x, points[0]!.y);

  for (let i = 1; i < points.length - 1; i++) {
    const at = points[i]!;
    const before = points[i - 1]!;
    const after = points[i + 1]!;
    const radius = Math.min(
      13,
      Math.hypot(at.x - before.x, at.y - before.y) / 2,
      Math.hypot(after.x - at.x, after.y - at.y) / 2,
    );

    const inLen = Math.hypot(at.x - before.x, at.y - before.y) || 1;
    const outLen = Math.hypot(after.x - at.x, after.y - at.y) || 1;
    const entry = {
      x: at.x - ((at.x - before.x) / inLen) * radius,
      y: at.y - ((at.y - before.y) / inLen) * radius,
    };
    const exit = {
      x: at.x + ((after.x - at.x) / outLen) * radius,
      y: at.y + ((after.y - at.y) / outLen) * radius,
    };

    context.lineTo(entry.x, entry.y);
    context.quadraticCurveTo(at.x, at.y, exit.x, exit.y);
  }

  const end = points[points.length - 1]!;
  context.lineTo(end.x, end.y);
}

function paintSnake({
  context,
  game,
  progress,
  accent,
  fade,
}: {
  context: CanvasRenderingContext2D;
  game: SnakeGame;
  progress: number;
  accent: string;
  fade: number;
}) {
  const runs = spineRuns(game, progress);

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = accent;

  // A wide soft pass underneath, then the body over it: light the grid line
  // carries, not a wire laid on top of it.
  context.globalAlpha = 0.14 * fade;
  context.lineWidth = 11;
  context.shadowColor = accent;
  context.shadowBlur = 22;
  for (const run of runs) {
    context.beginPath();
    traceRounded(context, run);
    context.stroke();
  }

  context.globalAlpha = 0.92 * fade;
  context.lineWidth = 4.5;
  context.shadowBlur = 0;
  for (const run of runs) {
    context.beginPath();
    traceRounded(context, run);
    context.stroke();
  }

  // The head: a hot cap with a white core, so the eye always knows which end
  // is alive.
  const head = runs[0]![0]!;
  context.globalAlpha = fade;
  context.fillStyle = accent;
  context.shadowColor = accent;
  context.shadowBlur = 16;
  context.beginPath();
  context.arc(head.x, head.y, 5, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(255, 244, 235, 0.95)";
  context.shadowBlur = 0;
  context.beginPath();
  context.arc(head.x, head.y, 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

const STEP_PIXELS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -CELL },
  down: { x: 0, y: CELL },
  left: { x: -CELL, y: 0 },
  right: { x: CELL, y: 0 },
};

/**
 * Lysergic acid diethylamide, as a skeleton: three fused six-rings and the
 * indole's five, with the diethylamide hanging off the end. Built from ring
 * geometry rather than a hand-typed path so the fusions actually meet.
 */
const MOLECULE = buildMolecule();

function buildMolecule() {
  const r = 5.2;
  const span = r * Math.sqrt(3);
  /** The centre of the ring fused across the edge facing `degrees`. */
  const fused = (
    centre: readonly [number, number],
    degrees: number,
  ): readonly [number, number] => [
    centre[0] + span * Math.cos((degrees * Math.PI) / 180),
    centre[1] + span * Math.sin((degrees * Math.PI) / 180),
  ];

  const polygon = (
    centre: readonly [number, number],
    radius: number,
    sides: number,
  ) => {
    const points = Array.from({ length: sides }, (_, i) => {
      const angle = (i * 2 * Math.PI) / sides;
      return [
        centre[0] + radius * Math.cos(angle),
        centre[1] + radius * Math.sin(angle),
      ] as const;
    });
    return [...points, points[0]!];
  };

  const a: readonly [number, number] = [0, 0];
  const c = fused(a, -30);
  const d = fused(c, 30);
  const b = fused(a, 210);

  const tail = d[0] + r;
  const strokes = [
    polygon(a, r, 6),
    polygon(c, r, 6),
    polygon(d, r, 6),
    // The indole's five-ring. A pentagon does not tile with hexagons, so it
    // is set slightly small and slightly in: at this size the eye reads the
    // ring count, never the bond angles.
    polygon(b, r * 0.86, 5),
    // The diethylamide: the carbonyl, then the nitrogen's two ethyls.
    [
      [tail, d[1]],
      [tail + 4.6, d[1] - 2.6],
      [tail + 9.2, d[1]],
    ] as const,
    [
      [tail + 4.6, d[1] - 2.6],
      [tail + 4.6, d[1] - 6.4],
    ] as const,
    [
      [tail + 9.2, d[1]],
      [tail + 13.4, d[1] - 2.4],
    ] as const,
    [
      [tail + 9.2, d[1]],
      [tail + 13.4, d[1] + 2.4],
    ] as const,
  ];

  const all = strokes.flat();
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  const centre: readonly [number, number] = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];

  // Centred on its own bounding box, so it sits ON the intersection it
  // occupies rather than hanging off one corner of it.
  return strokes.map((stroke) =>
    stroke.map(([x, y]) => [x - centre[0], y - centre[1]] as const),
  );
}

/** Not a token colour: nothing else on the auth screens is allowed to be this. */
const MOLECULE_INK = "#b58cff";

/** Ease both ends of a glide, so each step lands instead of stopping. */
const easeInOut = (t: number) => t * t * (3 - 2 * t);

/**
 * Where the molecule is THIS frame: gliding between the node it left and the
 * node the rules put it on, across the whole of its slower beat. The rules
 * teleport it a node at a time; the glide is what the eye sees instead.
 */
function moleculeAt(game: SnakeGame, fx: Effects, now: number) {
  const from = fx.chaserFrom;
  const to = game.chaser;
  if (!adjacent(from, to)) return px(to);

  const t = easeInOut(
    Math.min(1, (now - fx.chaserMovedAt) / (TICK_MS * CHASER_EVERY)),
  );
  const a = px(from);
  const b = px(to);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function paintMolecule({
  context,
  game,
  fx,
  now,
}: {
  context: CanvasRenderingContext2D;
  game: SnakeGame;
  fx: Effects;
  now: number;
}) {
  const at = moleculeAt(game, fx, now);
  // It is unwell: a slow tumble and a faint breath, never a straight run.
  const tumble = Math.sin(now / 650) * 0.14;
  const breath = 0.92 + 0.08 * Math.sin(now / 900);

  context.save();
  context.translate(at.x, at.y + Math.sin(now / 780) * 1.6);
  context.rotate(tumble);
  context.scale(breath, breath);
  context.strokeStyle = MOLECULE_INK;
  context.shadowColor = MOLECULE_INK;
  context.shadowBlur = 12;
  context.lineWidth = 1.4;
  context.lineJoin = "round";
  context.globalAlpha = 0.95;

  for (const stroke of MOLECULE) {
    context.beginPath();
    stroke.forEach(([x, y], i) =>
      i === 0 ? context.moveTo(x, y) : context.lineTo(x, y),
    );
    context.stroke();
  }

  context.restore();
}
