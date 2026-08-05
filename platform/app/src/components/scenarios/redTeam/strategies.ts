import type { RedTeamStrategyName } from "~/server/scenarios/execution/types";

/**
 * How each strategy is presented. Named for what it is — a list of options for
 * one picker — rather than sharing `RED_TEAM_STRATEGIES` with the contract in
 * `execution/types`, which is the tuple the schemas are built from. Two exports
 * under one name with two different shapes is how an import ends up pointing at
 * the wrong one.
 *
 * `value` is typed against the contract, so dropping or renaming a strategy
 * there fails the build here instead of quietly leaving a button that writes an
 * unknown value.
 */
export const RED_TEAM_STRATEGY_OPTIONS: {
  value: RedTeamStrategyName;
  label: string;
  description: string;
  help: string;
}[] = [
  {
    value: "crescendo" as const,
    label: "Crescendo",
    description: "Warms up, then escalates gradually across turns.",
    help: "Opens with harmless questions and escalates a little each turn, so the agent is asked for something slightly worse than it just agreed to. Good default: it finds agents that hold on a direct ask but drift under gradual pressure.",
  },
  {
    value: "goat" as const,
    label: "GOAT",
    description: "Picks a fresh angle every turn.",
    help: "Chooses from seven techniques each turn — roleplay, hypotheticals, authority pressure, hiding the ask among innocent ones — based on how the agent replied. Reach for it when Crescendo has already failed against an agent. It needs room to work: under about ten turns it spends them exploring instead of committing.",
  },
];

export const ATTACK_HELP =
  "A simulated attacker drives the conversation instead of a cooperative user, trying to make your agent do something it should refuse. The criteria below are what it must fail to achieve — they are how the run is judged. Only run this against agents you own or have permission to test.";
