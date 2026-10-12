/** Rng is a seeded stream of numbers in [0, 1): the same seed always gives the same stream. */
export type Rng = () => number;

/** hashSeed folds any parts into one 32-bit seed (FNV-1a), so a route's stream is its own. */
export const hashSeed = (parts: readonly (string | number)[]): number => {
  let hash = 0x811c9dc5;
  for (const char of parts.join("\u0000")) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
  }
  return hash >>> 0;
};

/** mulberry32 is a small, fast generator with a full 32-bit state. */
export const mulberry32 = (seed: number): Rng => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

/** oneOf picks an item; an empty list has none. */
export const oneOf = <Item>({
  rng,
  items,
}: {
  rng: Rng;
  items: readonly Item[];
}): Item | undefined => items[Math.floor(rng() * items.length)];

/** shuffled returns a seeded permutation, leaving the input alone. */
export const shuffled = <Item>({ rng, items }: { rng: Rng; items: readonly Item[] }): Item[] => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index--) {
    const other = Math.floor(rng() * (index + 1));
    [out[index], out[other]] = [out[other] as Item, out[index] as Item];
  }
  return out;
};
