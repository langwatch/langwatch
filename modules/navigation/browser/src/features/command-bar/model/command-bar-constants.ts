/**
 * Icon color mapping for different item types.
 * Maps feature/entity keys to Chakra UI color tokens.
 */
export const iconColors: Record<string, string> = {
  // Langy activation — brand orange, so the "Ask Langy" row reads as the door
  // into the assistant.
  "ask-langy": "orange.fg",
  // Main navigation pages
  home: "orange.fg",
  analytics: "blue.fg",
  traces: "green.fg",
  messages: "green.fg",
  simulations: "purple.fg",
  scenarios: "purple.fg",
  evaluations: "teal.fg",
  experiments: "teal.fg",
  annotations: "yellow.fg",
  "annotations-all": "yellow.fg",
  "annotations-inbox": "yellow.fg",
  "annotations-queue": "yellow.fg",
  prompts: "cyan.fg",
  agents: "pink.fg",
  workflows: "indigo.400",
  evaluators: "red.fg",
  datasets: "blue.fg",
  triggers: "orange.fg",
  // Settings pages
  settings: "fg.muted",
  "settings-members": "blue.fg",
  "settings-teams": "blue.fg",
  "settings-projects": "green.fg",
  "settings-roles": "purple.fg",
  "settings-model-providers": "orange.fg",
  "settings-model-costs": "green.fg",
  "settings-annotation-scores": "yellow.fg",
  "settings-topic-clustering": "cyan.fg",
  "settings-usage": "blue.fg",
  "settings-subscription": "pink.fg",
  "settings-authentication": "red.fg",
  "settings-audit-log": "fg.muted",
  "settings-license": "fg.muted",
  // Entity types
  prompt: "cyan.fg",
  agent: "pink.fg",
  dataset: "blue.fg",
  workflow: "indigo.400",
  evaluator: "red.fg",
  project: "orange.fg",
  // Phase 2: Trace and span types
  "search-traces": "green.fg",
  trace: "green.fg",
  span: "green.fg",
  "simulation-run": "purple.fg",
  scenario: "purple.fg",
  experiment: "teal.fg",
  trigger: "orange.fg",
  // Support and help
  "open-chat": "blue.fg",
  docs: "cyan.fg",
  github: "fg.muted",
  discord: "purple.fg",
  status: "green.fg",
  "feature-request": "yellow.fg",
  "bug-report": "red.fg",
  // Theme commands
  "theme-light": "yellow.fg",
  "theme-dark": "purple.fg",
  "theme-system": "blue.fg",
};

/**
 * Tips to help users get the most out of LangWatch.
 * Displayed randomly in the command bar footer.
 */
export const HINTS = [
  // Langy
  "Ask Langy! Type a question, pick “Ask Langy”, and it reads your project to answer.",
  "One Cmd+K Away! “Ask Langy” hands your question straight to the assistant.",
  "Morning Briefing! Langy reads your project on the home page and flags what needs a look.",
  "Plain English! Describe what's wrong and let Langy dig through traces, evals and runs.",

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
/** Debounce delay in ms for search queries — responsive but batches keystrokes. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Minimum query length before searching */
export const MIN_SEARCH_QUERY_LENGTH = 2;
/** Minimum query length before matching category keywords (e.g., "nav" for Navigation) */
export const MIN_CATEGORY_MATCH_LENGTH = 3;
