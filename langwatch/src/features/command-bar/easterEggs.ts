import { Sparkles, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface EasterEgg {
  id: string;
  triggers: string[]; // Query strings that trigger this
  label: string;
  icon: LucideIcon;
  effect: "confetti" | "barrelRoll" | "toast";
  toastMessage?: string;
  /** If true, don't close the command bar after triggering */
  keepOpen?: boolean;
}

export const easterEggs: EasterEgg[] = [
  // Confetti
  {
    id: "easter-confetti",
    triggers: ["🎉", "confetti", "party", "celebrate"],
    label: "Party Time!",
    icon: Sparkles,
    effect: "confetti",
  },
  // Barrel Roll
  {
    id: "easter-barrel-roll",
    triggers: ["barrel roll", "do a barrel roll", "spin"],
    label: "Do a barrel roll!",
    icon: RotateCw,
    effect: "barrelRoll",
    keepOpen: true,
  },
  // 42 - The Answer
  {
    id: "easter-42",
    triggers: ["42", "meaning of life"],
    label: "42",
    icon: Sparkles,
    effect: "toast",
    toastMessage: "The answer to life, the universe, and everything.",
  },
];

export function findEasterEgg(query: string): EasterEgg | null {
  const lower = query.toLowerCase().trim();
  return (
    easterEggs.find((egg) =>
      egg.triggers.some((t) => t.toLowerCase() === lower)
    ) ?? null
  );
}
