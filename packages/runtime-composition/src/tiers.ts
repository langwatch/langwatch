/**
 * Tier choice: "live" (real stores) vs "memory" (in-memory).
 * No default; absence selects in-memory, which silently serves empty lists.
 */
export type Tier = "live" | "memory";
