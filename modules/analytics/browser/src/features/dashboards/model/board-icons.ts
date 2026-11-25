/**
 * The board icon picker's words: each allow-listed icon with the terms a member may search it
 * by. Pure, so the picker and its tests read one rule.
 * @see modules/dashboard/specs/dashboard-icons.feature
 */

import { DASHBOARD_ICONS, type DashboardIcon } from "@langwatch/dashboard-contract";

/** Extra search terms per icon; the icon's own name is always searched too. */
const KEYWORDS: Readonly<Record<DashboardIcon, string>> = {
  "layout-dashboard": "board home overview",
  "chart-column": "bar graph metrics",
  "chart-bar": "horizontal graph metrics",
  "chart-line": "trend graph time series",
  "chart-area": "graph volume",
  "chart-pie": "share breakdown split",
  "trending-up": "growth increase rising",
  "trending-down": "decline decrease falling",
  activity: "pulse health heartbeat",
  gauge: "speed performance meter",
  target: "goal objective kpi",
  "dollar-sign": "money cost spend price",
  coins: "money cost budget",
  wallet: "money budget spend",
  "credit-card": "billing payment",
  receipt: "invoice billing cost",
  "piggy-bank": "savings budget",
  banknote: "money cash",
  users: "people team customers",
  user: "person member",
  "user-check": "verified approved member",
  "building-2": "company organisation office",
  briefcase: "business work",
  store: "shop marketplace",
  "shield-check": "security quality safe guardrails",
  "shield-alert": "security risk threat",
  lock: "private secret security",
  "key-round": "access credentials api key",
  bell: "alert notification",
  "triangle-alert": "warning error problem",
  "circle-alert": "warning error problem",
  siren: "incident alarm emergency",
  clock: "time latency duration",
  timer: "latency duration speed",
  calendar: "date schedule daily",
  hourglass: "wait queue time",
  bot: "agent assistant ai robot",
  brain: "ai model intelligence",
  sparkles: "ai magic generated",
  cpu: "compute model hardware",
  "wand-sparkles": "ai magic",
  "message-square": "chat conversation prompt",
  "messages-square": "chat conversations threads",
  zap: "fast power energy",
  rocket: "launch release deploy",
  "flask-conical": "experiment test lab",
  bug: "error defect issue",
  wrench: "tools fix maintenance",
  settings: "config options",
  "sliders-horizontal": "tuning parameters filters",
  terminal: "command line cli shell",
  code: "developer source",
  database: "data storage",
  server: "infrastructure host",
  cloud: "hosting provider",
  globe: "world web region",
  "map-pin": "location place",
  network: "graph connections",
  workflow: "pipeline flow steps",
  "git-branch": "version release",
  layers: "stack levels",
  plug: "integration connector",
  radio: "signal stream live",
  box: "package container",
  package: "release bundle",
  truck: "delivery shipping",
  "shopping-cart": "orders commerce",
  flag: "milestone marker",
  star: "favourite rating",
  bookmark: "saved marker",
  search: "find lookup",
  funnel: "filter segment narrow",
  "list-checks": "checklist tasks evaluations",
  "clipboard-list": "report list tasks",
  "scroll-text": "logs text",
  "book-open": "docs guide knowledge",
  lightbulb: "idea insight",
  flame: "hot trending",
  award: "quality prize",
  trophy: "winner best",
};

/** The icons whose name or terms hold every word of `query`, in list order; all when blank. */
export function searchBoardIcons({ query }: { query: string }): readonly DashboardIcon[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return DASHBOARD_ICONS;
  return DASHBOARD_ICONS.filter((icon) => {
    const haystack = `${icon.replaceAll("-", " ")} ${KEYWORDS[icon]}`;
    return words.every((word) => haystack.includes(word));
  });
}

/** "chart-line" as a member reads it: "Chart line". */
export function boardIconLabel(icon: DashboardIcon): string {
  const spaced = icon.replaceAll("-", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** How many icons a picker row holds. */
export const BOARD_ICON_COLUMNS = 8;

/**
 * Where an arrow key moves focus in the picker's grid; the same place at an edge, so the
 * focus never leaves the grid. Any other key answers `index`.
 */
export function nextBoardIconIndex({
  index,
  key,
  count,
}: {
  index: number;
  key: string;
  count: number;
}): number {
  const step = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: BOARD_ICON_COLUMNS,
    ArrowUp: -BOARD_ICON_COLUMNS,
  }[key];
  if (step === void 0) return index;
  const next = index + step;
  return next < 0 || next >= count ? index : next;
}
