import { nanoid } from "nanoid";

/**
 * Generates a `CustomGraph` id (dashboard widgets, saved workbench charts).
 *
 * nanoid's default alphabet includes "-" and "_", so a plain `nanoid()` call
 * can hand back an id that starts with either. That is valid for nanoid
 * itself, but the `langwatch dashboard-widget`/`chart` CLI reads a
 * leading-dash positional as an unknown option — a live widget id of
 * `-L4zZkoUV0wTwci1YiTtb` failed 4 of 9 Langy CLI calls in one turn before
 * the CLI itself grew a `--id` escape hatch. Rerolling the rare id whose
 * first character would collide keeps every other position's full
 * 64-character entropy, and any id already in the database — those made it
 * to the database and stay valid; only newly generated ones are affected.
 */
export function generateCustomGraphId(): string {
  let id = nanoid();
  while (id.startsWith("-") || id.startsWith("_")) {
    id = nanoid();
  }
  return id;
}
