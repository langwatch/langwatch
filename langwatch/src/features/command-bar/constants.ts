/**
 * Command Bar Constants
 *
 * Centralized configuration for the command bar feature.
 * Extracted from CommandBar.tsx for maintainability and testability.
 */

/**
 * Icon color mapping for different item types.
 * Maps feature/entity keys to Chakra UI color tokens.
 */
export const iconColors: Record<string, string> = {
  // Main navigation pages
  home: "orange.400",
  analytics: "blue.400",
  traces: "green.400",
  messages: "green.400",
  simulations: "purple.400",
  scenarios: "purple.300",
  evaluations: "teal.400",
  experiments: "teal.300",
  annotations: "yellow.400",
  "annotations-all": "yellow.400",
  "annotations-inbox": "yellow.300",
  "annotations-queue": "yellow.300",
  prompts: "cyan.400",
  agents: "pink.400",
  workflows: "indigo.400",
  evaluators: "red.400",
  datasets: "blue.300",
  triggers: "orange.300",
  // Settings pages
  settings: "gray.400",
  "settings-members": "blue.400",
  "settings-teams": "blue.300",
  "settings-projects": "green.400",
  "settings-roles": "purple.400",
  "settings-model-providers": "orange.400",
  "settings-model-costs": "green.300",
  "settings-annotation-scores": "yellow.400",
  "settings-topic-clustering": "cyan.400",
  "settings-usage": "blue.400",
  "settings-subscription": "pink.400",
  "settings-authentication": "red.400",
  "settings-audit-log": "gray.400",
  "settings-license": "gray.400",
  // Entity types
  prompt: "cyan.400",
  agent: "pink.400",
  dataset: "blue.300",
  workflow: "indigo.400",
  evaluator: "red.400",
  project: "orange.300",
  // Phase 2: Trace and span types
  "search-traces": "green.400",
  trace: "green.400",
  span: "green.300",
  "simulation-run": "purple.400",
  scenario: "purple.300",
  experiment: "teal.300",
  trigger: "orange.300",
  "sdk-radar": "orange.400",
  // Support and help
  "open-chat": "blue.400",
  docs: "cyan.400",
  github: "gray.400",
  discord: "purple.400",
  status: "green.400",
  "feature-request": "yellow.400",
  "bug-report": "red.400",
  // Theme commands
  "theme-light": "yellow.400",
  "theme-dark": "purple.400",
  "theme-system": "blue.400",
};

/**
 * Tips to help users get the most out of LangWatch.
 * Displayed randomly in the command bar footer.
 */
export const HINTS = [
  // Useful tips
  "Quick Jump! Paste a trace ID to teleport directly to that trace.",
  "Auto Grader! Use Evaluations to automatically score your LLM outputs.",
  "Stay Alert! Set up Triggers to get notified when issues occur.",
  "Instant Replay! Create Datasets from your traces for regression testing.",
  "Gold Stars! Use Annotations to label traces for fine-tuning.",
  "Stress Test! Try Simulations to test your agents with synthetic users.",
  "Version Control! Track prompt changes with the Prompts registry.",
  "Number Cruncher! Use Analytics to monitor costs and performance trends.",
  "Custom Judge! Set up custom Evaluators for domain-specific quality checks.",
  "Chain Gang! Use Workflows to chain evaluations together.",
  "Safety First! Use Guardrails to block harmful responses in real-time.",
  "Prompt Wizard! Use DSPy optimization to automatically find better prompts.",
  "Pick Your Poison! Choose from 40+ built-in evaluators or create your own.",
  "Thumbs Up! Capture user feedback with thumbs ratings to measure satisfaction.",
  "Lab Coat! Run Experiments to A/B test prompt variations and compare results.",
  "Always Watching! Set up Monitors to continuously score production traffic.",
  "Git Sync! Connect your Prompts registry to GitHub for version control.",
  "Data Factory! Generate synthetic datasets with AI to bootstrap your testing.",
  "Expert Mode! Set up annotation queues for structured human review workflows.",
  "Bridge Builder! Integrate with LangChain, LangGraph, CrewAI and 15+ frameworks.",
  "Your House! Self-host LangWatch on Docker or Kubernetes for full data control.",

  // Fun tips
  "Dry January? Connect with your favourite no code platform such as n8n, Langflow, or Flowise.",
  "Token Hoarder? Check Analytics to see which prompts are burning through your budget.",
  "Deja Vu! Create Datasets from production traces to replay that one weird edge case.",
  "Trust Issues? Use guardrail Evaluators to keep your AI from going rogue.",
  "Enter the Matrix! Test your agent with a simulated users before real ones show up.",
  "New to LangWatch? Feel free to ask for help. We don't bite.",
  "Did you know? Taylor Swift is one of the best artists of our generation.",
];

// Layout constants
/** Maximum height of the results list, fits ~10 items without scroll */
export const COMMAND_BAR_MAX_HEIGHT = "480px";
/** Top margin positioning the bar in upper third of viewport */
export const COMMAND_BAR_TOP_MARGIN = "12vh";
/** Maximum width of the command bar */
export const COMMAND_BAR_MAX_WIDTH = "680px";

// Recent items constants
/** Maximum number of recent items to store in localStorage */
export const MAX_RECENT_ITEMS = 50;
/** Number of recent items to show in the command bar */
export const RECENT_ITEMS_DISPLAY_LIMIT = 5;

// Search constants
/** Debounce delay in ms for search queries - fast enough for responsive feel, slow enough to batch keystrokes */
export const SEARCH_DEBOUNCE_MS = 300;
/** Minimum query length before searching */
export const MIN_SEARCH_QUERY_LENGTH = 2;
/** Minimum query length before matching category keywords (e.g., "nav" for Navigation) */
export const MIN_CATEGORY_MATCH_LENGTH = 3;
