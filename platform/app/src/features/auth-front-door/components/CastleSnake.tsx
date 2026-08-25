import { Box, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { MONO_FONT } from "../frontDoorTheme";
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
 * `lw-front-door-signal-grid` already draws — eating tokens, pursued by a
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
 *   - **It rides the flag.** `FrontDoorShell` mounts it, so it exists exactly
 *     where the D13 screens exist and nowhere else.
 *   - **It takes only the keys it uses.** The arrows and Escape, while a game
 *     is actually running. Typing is untouched.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * This is the one thing on the front door that moves under
 * `prefers-reduced-motion: reduce`, and that is deliberate, not an oversight.
 * The setting asks not to be moved at by a page; it does not ask for a game
 * that somebody just deliberately started to sit still. Everything ambient —
 * the entrance, the warp, the rise — stays stood down exactly as before.
 * Please do not "fix" this by gating it.
 *
 * Spec: specs/identity/front-door-castle-snake.feature
 */

/** The pitch of the ground's signal grid. Change one, change the other. */
const CELL = 72;

/** Fast enough to be a game, slow enough to be read at a glance. */
const TICK_MS = 118;

/** The molecule moves at two thirds of the pace. That is the difficulty. */
const CHASER_EVERY = 3;

/** Where the double-tap is heard. Both front-door layouts mark their mark. */
const CASTLE = '[data-auth-card-logo], [data-testid="front-door-panel-logo"]';

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
        <Text as="span" color="frontDoor.detail">
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

/** One beat of the world: the snake always, the molecule every third time. */
const tick = ({ game, ticks }: { game: SnakeGame; ticks: number }) => {
  const moved = advance(game, Math.random);
  return ticks % CHASER_EVERY === 0 ? advanceChaser(moved) : moved;
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

    const loop = (now: number) => {
      let game = gameRef.current;

      while (game && !game.ending && now - lastTick >= TICK_MS) {
        lastTick += TICK_MS;
        ticks += 1;
        game = tick({ game, ticks });
        gameRef.current = game;
        setHud(hudOf(game));
      }

      if (game)
        paint({ context, game, progress: progressOf(game, now, lastTick) });

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
    `--chakra-colors-front-door-${token}`,
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
  progress,
}: {
  context: CanvasRenderingContext2D;
  game: SnakeGame;
  progress: number;
}) {
  const accent = themed("detail", "#f56b1a");
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);

  paintToken({ context, game, accent });
  paintSnake({ context, game, progress, accent });
  paintMolecule({ context, game });
}

function paintToken({
  context,
  game,
  accent,
}: {
  context: CanvasRenderingContext2D;
  game: SnakeGame;
  accent: string;
}) {
  const at = px(game.token);

  context.save();
  context.fillStyle = accent;
  context.shadowColor = accent;
  context.shadowBlur = 14;
  context.beginPath();
  context.arc(at.x, at.y, 4.5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function paintSnake({
  context,
  game,
  progress,
  accent,
}: {
  context: CanvasRenderingContext2D;
  game: SnakeGame;
  progress: number;
  accent: string;
}) {
  context.save();
  context.strokeStyle = accent;
  context.globalAlpha = game.ending ? 0.45 : 0.9;
  context.lineWidth = 3;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (let i = 0; i < game.snake.length - 1; i++) {
    const from = game.snake[i]!;
    const to = game.snake[i + 1]!;
    if (!adjacent(from, to)) continue;

    const a = px(from);
    const b = px(to);
    const last = i === game.snake.length - 2;

    context.beginPath();
    context.moveTo(a.x, a.y);
    // The tail retracts across the tick rather than vanishing on it, which
    // is what makes the crawl continuous instead of a series of hops.
    context.lineTo(
      last ? a.x + (b.x - a.x) * (1 - progress) : b.x,
      last ? a.y + (b.y - a.y) * (1 - progress) : b.y,
    );
    context.stroke();
  }

  // ...and the head reaches for the node it is on its way to.
  const head = px(game.snake[0]!);
  const step = STEP_PIXELS[game.direction];
  context.beginPath();
  context.moveTo(head.x, head.y);
  context.lineTo(head.x + step.x * progress, head.y + step.y * progress);
  context.stroke();
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

/** Not a token colour: nothing else on the front door is allowed to be this. */
const MOLECULE_INK = "#b58cff";

function paintMolecule({
  context,
  game,
}: {
  context: CanvasRenderingContext2D;
  game: SnakeGame;
}) {
  const at = px(game.chaser);

  context.save();
  context.translate(at.x, at.y);
  context.scale(0.86, 0.86);
  context.strokeStyle = MOLECULE_INK;
  context.shadowColor = MOLECULE_INK;
  context.shadowBlur = 10;
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
