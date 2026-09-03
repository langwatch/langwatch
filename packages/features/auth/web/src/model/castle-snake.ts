/**
 * The castle Snake easter egg, as rules rather than pixels.
 *
 * Everything here is pure and deterministic: the caller injects the random
 * source, so a test can play a whole game by hand and the renderer can stay a
 * thin loop over `advance`. Nothing in this module touches the DOM, a canvas,
 * or the clock.
 *
 * The board is the ground's own signal grid (`lw-front-door-signal-grid`,
 * 72px), and the snake runs along the LINES of it rather than through the
 * cells — so a position is an intersection, and a move is one edge. That is
 * why the coordinates here are lattice nodes and carry no pixels: what a node
 * is worth in pixels belongs to the renderer.
 *
 * Spec: specs/identity/front-door-castle-snake.feature
 */

export type Point = { readonly x: number; readonly y: number };

export type Direction = "up" | "down" | "left" | "right";

/** Why the game stopped, so the renderer can say the right thing. */
export type Ending = "eaten-by-the-molecule" | "ate-itself";

export type SnakeGame = {
  /** Intersections across and down, so the far edge is `cols - 1`. */
  readonly cols: number;
  readonly rows: number;
  /** Head first. Always at least one node long. */
  readonly snake: readonly Point[];
  readonly direction: Direction;
  /**
   * A turn asked for since the last tick. Held rather than applied at once,
   * so two quick presses inside one tick cannot fold the snake back through
   * its own neck.
   */
  readonly queued: Direction | null;
  readonly token: Point;
  readonly chaser: Point;
  readonly eaten: number;
  readonly ending: Ending | null;
};

const STEPS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

/** The lattice wraps: it is a ground, not a room, so it has no walls. */
const wrap = (value: number, limit: number) => ((value % limit) + limit) % limit;

const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/**
 * The shorter way round a wrapping axis, signed. On a board that wraps, the
 * chaser reaching for the far edge should go off its own near edge instead of
 * walking the whole width.
 */
const shortestDelta = (from: number, to: number, limit: number) => {
  const direct = to - from;
  if (Math.abs(direct) * 2 <= limit) return direct;
  return direct > 0 ? direct - limit : direct + limit;
};

const step = ({
  from,
  direction,
  cols,
  rows,
}: {
  from: Point;
  direction: Direction;
  cols: number;
  rows: number;
}): Point => {
  const delta = STEPS[direction];
  return {
    x: wrap(from.x + delta.x, cols),
    y: wrap(from.y + delta.y, rows),
  };
};

/**
 * Somewhere free to put the next token. Walks from a random node rather than
 * rejecting-and-retrying, so a nearly-full board still terminates.
 */
const freeNode = ({
  cols,
  rows,
  taken,
  random,
}: {
  cols: number;
  rows: number;
  taken: readonly Point[];
  random: () => number;
}): Point => {
  const total = cols * rows;
  const occupied = new Set(taken.map(({ x, y }) => y * cols + x));
  const start = Math.floor(random() * total) % total;

  for (let offset = 0; offset < total; offset++) {
    const index = (start + offset) % total;
    if (!occupied.has(index)) {
      return { x: index % cols, y: Math.floor(index / cols) };
    }
  }

  // Every node is snake. Whoever managed this has earned the tie.
  return { x: 0, y: 0 };
};

export const createGame = ({
  cols,
  rows,
  random,
}: {
  cols: number;
  rows: number;
  random: () => number;
}): SnakeGame => {
  const head = { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
  const snake = [head, { x: head.x - 1, y: head.y }];

  return {
    cols,
    rows,
    snake,
    direction: "right",
    queued: null,
    token: freeNode({ cols, rows, taken: snake, random }),
    // Starts a corner away, so the first seconds are a game rather than an
    // ambush.
    chaser: {
      x: wrap(head.x + Math.floor(cols / 3), cols),
      y: wrap(head.y - 2, rows),
    },
    eaten: 0,
    ending: null,
  };
};

/**
 * Ask for a turn. A reversal is dropped rather than ending the game: on a
 * one-node-thick snake it reads as an instant self-collision, which is a
 * punishment for a fumbled key rather than for a mistake.
 */
export const queueTurn = (game: SnakeGame, direction: Direction): SnakeGame => {
  if (game.ending) return game;
  if (direction === OPPOSITE[game.direction]) return game;
  if (direction === game.direction) return game;
  return { ...game, queued: direction };
};

/** The bookkeeping every tick does, whatever the tick ran into. */
const moved = ({
  game,
  snake,
  direction,
}: {
  game: SnakeGame;
  snake: readonly Point[];
  direction: Direction;
}): SnakeGame => ({ ...game, snake, direction, queued: null });

/** One tick of the snake: turn, move, eat, and check what it ran into. */
export const advance = (game: SnakeGame, random: () => number): SnakeGame => {
  if (game.ending) return game;

  const direction = game.queued ?? game.direction;
  const head = step({
    from: game.snake[0]!,
    direction,
    cols: game.cols,
    rows: game.rows,
  });
  const ate = samePoint(head, game.token);

  // The tail vacates on the same tick unless the snake is growing, so the
  // node it is leaving is not a collision — following your own tail is legal.
  const body = ate ? game.snake : game.snake.slice(0, -1);
  const snake = [head, ...body];

  if (body.some((node) => samePoint(node, head))) {
    return { ...moved({ game, snake, direction }), ending: "ate-itself" };
  }

  return {
    ...moved({ game, snake, direction }),
    token: ate ? freeNode({ cols: game.cols, rows: game.rows, taken: snake, random }) : game.token,
    eaten: ate ? game.eaten + 1 : game.eaten,
  };
};

/**
 * Which way to close, given how far there is to go on each axis. Whichever
 * gap is wider, one node at a time — it cannot cut a corner, which is what
 * makes it escapable: a turn always buys a node.
 */
const pursue = ({ dx, dy }: { dx: number; dy: number }): Direction => {
  if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  if (dy !== 0) return dy > 0 ? "down" : "up";
  return dx > 0 ? "right" : "left";
};

/**
 * One tick of the molecule. It closes on the head along whichever axis it is
 * furthest away on, which is enough to be frightening and simple enough to be
 * escapable — it cannot cut a corner, so a turn always buys a node.
 *
 * The renderer ticks it slower than the snake. That is the whole difficulty
 * curve, and it is deliberately gentle: this is an easter egg, and the reward
 * for finding it should not be losing immediately.
 */
export const advanceChaser = (game: SnakeGame): SnakeGame => {
  if (game.ending) return game;

  const head = game.snake[0]!;
  const direction = pursue({
    dx: shortestDelta(game.chaser.x, head.x, game.cols),
    dy: shortestDelta(game.chaser.y, head.y, game.rows),
  });

  const chaser = step({
    from: game.chaser,
    direction,
    cols: game.cols,
    rows: game.rows,
  });
  const caught = game.snake.some((node) => samePoint(node, chaser));

  return {
    ...game,
    chaser,
    ending: caught ? "eaten-by-the-molecule" : game.ending,
  };
};
