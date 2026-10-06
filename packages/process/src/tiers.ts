/**
 * Tier choice: "live" (real stores) vs "memory" (in-memory twins), §7.
 * No default: a module with repositories boots only on a tier its stores or caller stated.
 */
export type Tier = "live" | "memory";
