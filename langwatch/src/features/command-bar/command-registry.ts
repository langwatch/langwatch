import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  BookText,
  Bug,
  CheckSquare,
  CreditCard,
  DollarSign,
  FileText,
  FlaskConical,
  Github,
  Home,
  Inbox,
  Key,
  Lightbulb,
  ListTree,
  MessageCircle,
  Monitor,
  Moon,
  Pencil,
  Percent,
  Play,
  Plus,
  ScrollText,
  Settings,
  Shield,
  Stethoscope,
  Sun,
  Table,
  Tags,
  TrendingUp,
  Users,
  Workflow,
  FolderKanban,
  UserCog,
  Building2,
} from "lucide-react";
import type { Command } from "./types";

// Check if dark mode feature is enabled via build-time env var
const isDarkModeEnabled =
  process.env.NEXT_PUBLIC_FEATURE_DARK_MODE === "true" ||
  process.env.NEXT_PUBLIC_FEATURE_DARK_MODE === "1";

/**
 * Static navigation commands that map to main app routes.
 */
export const navigationCommands: Command[] = [
  // Main pages
  {
    id: "nav-home",
    label: "Home",
    description: "Project home",
    icon: Home,
    category: "navigation",
    keywords: ["dashboard", "start", "main"],
    path: "/[project]",
  },
  {
    id: "nav-analytics",
    label: "Analytics",
    description: "Analytics dashboard",
    icon: TrendingUp,
    category: "navigation",
    keywords: ["metrics", "stats", "charts", "data"],
    path: "/[project]/analytics",
  },
  {
    id: "nav-traces",
    label: "Traces",
    description: "View trace messages",
    icon: ListTree,
    category: "navigation",
    keywords: ["messages", "logs", "requests", "history"],
    path: "/[project]/messages",
  },
  {
    id: "nav-simulations",
    label: "Simulations",
    description: "Simulation runs",
    icon: Play,
    category: "navigation",
    keywords: ["test", "run", "execute"],
    path: "/[project]/simulations",
  },
  {
    id: "nav-scenarios",
    label: "Scenarios",
    description: "Simulations → Scenarios",
    icon: FlaskConical,
    category: "navigation",
    keywords: ["test", "simulation", "scenario"],
    path: "/[project]/simulations/scenarios",
  },
  {
    id: "nav-evaluations",
    label: "Evaluations",
    description: "View evaluations",
    icon: CheckSquare,
    category: "navigation",
    keywords: ["eval", "test", "assess", "check"],
    path: "/[project]/evaluations",
  },
  {
    id: "nav-experiments",
    label: "Experiments",
    description: "View experiments",
    icon: FlaskConical,
    category: "navigation",
    keywords: ["experiment", "test", "ab"],
    path: "/[project]/experiments",
  },
  {
    id: "nav-annotations",
    label: "Annotations",
    description: "Annotation queues",
    icon: Pencil,
    category: "navigation",
    keywords: ["label", "tag", "mark", "note"],
    path: "/[project]/annotations",
  },
  {
    id: "nav-annotations-all",
    label: "All Annotations",
    description: "Annotations → All",
    icon: Pencil,
    category: "navigation",
    keywords: ["label", "tag", "all"],
    path: "/[project]/annotations/all",
  },
  {
    id: "nav-annotations-inbox",
    label: "My Annotation Inbox",
    description: "Annotations → Inbox",
    icon: Inbox,
    category: "navigation",
    keywords: ["label", "inbox", "my"],
    path: "/[project]/annotations/me",
  },
  {
    id: "nav-annotations-queue",
    label: "My Annotation Queue",
    description: "Annotations → My Queue",
    icon: ListTree,
    category: "navigation",
    keywords: ["label", "queue", "my"],
    path: "/[project]/annotations/my-queue",
  },
  {
    id: "nav-prompts",
    label: "Prompts",
    description: "Manage prompts",
    icon: BookText,
    category: "navigation",
    keywords: ["template", "prompt", "text", "message"],
    path: "/[project]/prompts",
  },
  {
    id: "nav-agents",
    label: "Agents",
    description: "Manage agents",
    icon: Bot,
    category: "navigation",
    keywords: ["ai", "assistant", "bot", "automation"],
    path: "/[project]/agents",
  },
  {
    id: "nav-workflows",
    label: "Workflows",
    description: "Manage workflows",
    icon: Workflow,
    category: "navigation",
    keywords: ["flow", "pipeline", "process", "automation"],
    path: "/[project]/workflows",
  },
  {
    id: "nav-evaluators",
    label: "Evaluators",
    description: "Manage evaluators",
    icon: Percent,
    category: "navigation",
    keywords: ["eval", "scorer", "judge", "metric"],
    path: "/[project]/evaluators",
  },
  {
    id: "nav-datasets",
    label: "Datasets",
    description: "Manage datasets",
    icon: Table,
    category: "navigation",
    keywords: ["data", "records", "table", "collection"],
    path: "/[project]/datasets",
  },
  {
    id: "nav-automations",
    label: "Automations",
    description: "Manage automations",
    icon: Bell,
    category: "navigation",
    keywords: ["alert", "notification", "trigger", "automation"],
    path: "/[project]/automations",
  },

  // Settings pages
  {
    id: "nav-settings",
    label: "Settings",
    description: "Organization settings",
    icon: Settings,
    category: "navigation",
    keywords: ["config", "preferences", "options", "configure"],
    path: "/settings",
  },
  {
    id: "nav-settings-members",
    label: "Members",
    description: "Settings → Members",
    icon: Users,
    category: "navigation",
    keywords: ["users", "team", "people", "invite"],
    path: "/settings/members",
  },
  {
    id: "nav-settings-teams",
    label: "Teams",
    description: "Settings → Teams",
    icon: Building2,
    category: "navigation",
    keywords: ["team", "group", "department"],
    path: "/settings/teams",
  },
  {
    id: "nav-settings-projects",
    label: "Projects",
    description: "Settings → Projects",
    icon: FolderKanban,
    category: "navigation",
    keywords: ["project", "workspace"],
    path: "/settings/projects",
  },
  {
    id: "nav-settings-roles",
    label: "Roles",
    description: "Settings → Roles",
    icon: UserCog,
    category: "navigation",
    keywords: ["role", "permission", "access"],
    path: "/settings/roles",
  },
  {
    id: "nav-settings-model-providers",
    label: "Model Providers",
    description: "Settings → Model Providers",
    icon: Key,
    category: "navigation",
    keywords: ["api", "key", "openai", "anthropic", "provider", "llm"],
    path: "/settings/model-providers",
  },
  {
    id: "nav-settings-model-costs",
    label: "Model Costs",
    description: "Settings → Model Costs",
    icon: DollarSign,
    category: "navigation",
    keywords: ["cost", "price", "billing", "model"],
    path: "/settings/model-costs",
  },
  {
    id: "nav-settings-annotation-scores",
    label: "Annotation Scores",
    description: "Settings → Annotation Scores",
    icon: Tags,
    category: "navigation",
    keywords: ["annotation", "score", "label"],
    path: "/settings/annotation-scores",
  },
  {
    id: "nav-settings-topic-clustering",
    label: "Topic Clustering",
    description: "Settings → Topic Clustering",
    icon: Tags,
    category: "navigation",
    keywords: ["topic", "cluster", "group"],
    path: "/settings/topic-clustering",
  },
  {
    id: "nav-settings-usage",
    label: "Usage",
    description: "Settings → Usage",
    icon: TrendingUp,
    category: "navigation",
    keywords: ["usage", "billing", "quota"],
    path: "/settings/usage",
  },
  {
    id: "nav-settings-subscription",
    label: "Subscription",
    description: "Settings → Subscription",
    icon: CreditCard,
    category: "navigation",
    keywords: ["subscription", "billing", "plan", "payment"],
    path: "/settings/subscription",
  },
  {
    id: "nav-settings-plans",
    label: "Plans",
    description: "Settings → Plans",
    icon: CreditCard,
    category: "navigation",
    keywords: ["plans", "pricing", "compare", "billing"],
    path: "/settings/plans",
  },
  {
    id: "nav-settings-authentication",
    label: "Authentication",
    description: "Settings → Authentication",
    icon: Shield,
    category: "navigation",
    keywords: ["auth", "sso", "login", "security"],
    path: "/settings/authentication",
  },
  {
    id: "nav-settings-audit-log",
    label: "Audit Log",
    description: "Settings → Audit Log",
    icon: ScrollText,
    category: "navigation",
    keywords: ["audit", "log", "history", "activity"],
    path: "/settings/audit-log",
  },
  {
    id: "nav-settings-license",
    label: "License",
    description: "Settings → License",
    icon: FileText,
    category: "navigation",
    keywords: ["license", "key", "activation"],
    path: "/settings/license",
  },
];

/**
 * Action commands that trigger create/edit flows.
 */
export const actionCommands: Command[] = [
  {
    id: "action-new-agent",
    label: "New Agent",
    description: "Create a new agent",
    icon: Plus,
    category: "actions",
    keywords: ["create", "add", "agent", "bot"],
  },
  {
    id: "action-new-evaluation",
    label: "New Evaluation",
    description: "Create a new evaluation",
    icon: Plus,
    category: "actions",
    keywords: ["create", "add", "eval", "test"],
  },
  {
    id: "action-new-prompt",
    label: "New Prompt",
    description: "Create a new prompt",
    icon: Plus,
    category: "actions",
    keywords: ["create", "add", "prompt", "template"],
  },
  {
    id: "action-new-dataset",
    label: "New Dataset",
    description: "Create a new dataset",
    icon: Plus,
    category: "actions",
    keywords: ["create", "add", "data", "records"],
  },
  {
    id: "action-new-scenario",
    label: "New Scenario",
    description: "Create a new scenario",
    icon: Plus,
    category: "actions",
    keywords: ["create", "add", "scenario", "test"],
  },
  {
    id: "action-sdk-radar",
    label: "SDK Radar",
    description: "Check SDK version status",
    icon: Stethoscope,
    category: "actions",
    keywords: ["sdk", "version", "update", "outdated", "radar", "upgrade"],
  },
];

/**
 * Support/help commands that open external links.
 */
export const supportCommands: Command[] = [
  {
    id: "support-plans",
    label: "View Plans",
    description: "Manage subscription or license",
    icon: CreditCard,
    category: "actions",
    keywords: [
      "plan",
      "upgrade",
      "subscription",
      "billing",
      "license",
      "pricing",
    ],
    // Path is set dynamically in useFilteredCommands based on IS_SAAS
  },
  {
    id: "action-open-chat",
    label: "Open Chat",
    description: "Chat with support",
    icon: MessageCircle,
    category: "actions",
    keywords: ["help", "support", "chat", "crisp", "contact"],
  },
  {
    id: "action-docs",
    label: "Documentation",
    description: "Open LangWatch docs",
    icon: BookOpen,
    category: "actions",
    keywords: ["docs", "help", "guide", "manual", "documentation"],
    externalUrl: "https://docs.langwatch.ai",
  },
  {
    id: "action-github",
    label: "GitHub Support",
    description: "Get help on GitHub",
    icon: Github,
    category: "actions",
    keywords: ["github", "support", "help", "community"],
    externalUrl:
      "https://github.com/orgs/langwatch/discussions/categories/support",
  },
  {
    id: "action-discord",
    label: "Discord",
    description: "Join our Discord community",
    icon: MessageCircle,
    category: "actions",
    keywords: ["discord", "community", "chat", "help"],
    externalUrl: "https://discord.gg/kT4PhDS2gH",
  },
  {
    id: "action-status",
    label: "Status Page",
    description: "Check system status",
    icon: Activity,
    category: "actions",
    keywords: ["status", "uptime", "health", "outage"],
    externalUrl: "https://status.langwatch.ai/",
  },
  {
    id: "action-feature-request",
    label: "Feature Request",
    description: "Request a new feature",
    icon: Lightbulb,
    category: "actions",
    keywords: ["feature", "request", "idea", "suggestion"],
    externalUrl:
      "https://github.com/orgs/langwatch/discussions/categories/ideas",
  },
  {
    id: "action-bug-report",
    label: "Report a Bug",
    description: "Report an issue",
    icon: Bug,
    category: "actions",
    keywords: ["bug", "issue", "report", "problem", "error"],
    externalUrl: "https://github.com/langwatch/langwatch/issues",
  },
];

/**
 * Theme switching commands (only available when dark mode is enabled).
 */
export const themeCommands: Command[] = isDarkModeEnabled
  ? [
      {
        id: "action-theme-light",
        label: "Light Theme",
        description: "Switch to light mode",
        icon: Sun,
        category: "actions",
        keywords: ["theme", "light", "mode", "bright", "day"],
      },
      {
        id: "action-theme-dark",
        label: "Dark Theme",
        description: "Switch to dark mode",
        icon: Moon,
        category: "actions",
        keywords: ["theme", "dark", "mode", "night"],
      },
      {
        id: "action-theme-system",
        label: "System Theme",
        description: "Use system preference",
        icon: Monitor,
        category: "actions",
        keywords: ["theme", "system", "auto", "default"],
      },
    ]
  : [];

/**
 * Top-level navigation command IDs (shown by default).
 */
const topLevelNavIds = new Set([
  "nav-home",
  "nav-analytics",
  "nav-traces",
  "nav-simulations",
  "nav-evaluations",
  "nav-annotations",
  "nav-prompts",
  "nav-agents",
  "nav-workflows",
  "nav-evaluators",
  "nav-datasets",
  "nav-triggers",
  "nav-settings",
]);

/**
 * Top-level navigation commands (shown when query is empty).
 */
export const topLevelNavigationCommands: Command[] = navigationCommands.filter(
  (cmd) => topLevelNavIds.has(cmd.id),
);

/**
 * All static commands combined.
 */
export const allStaticCommands: Command[] = [
  ...navigationCommands,
  ...actionCommands,
  ...supportCommands,
  ...themeCommands,
];

/**
 * Filter commands by query string.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands;

  const lowerQuery = query.toLowerCase();
  return commands.filter((cmd) => {
    const labelMatch = cmd.label.toLowerCase().includes(lowerQuery);
    const descriptionMatch = cmd.description
      ?.toLowerCase()
      .includes(lowerQuery);
    const keywordMatch = cmd.keywords?.some((kw) =>
      kw.toLowerCase().includes(lowerQuery),
    );
    return labelMatch || descriptionMatch || keywordMatch;
  });
}
