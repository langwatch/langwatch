import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * The Lucide icons a board may carry, by kebab-case name. One list for the browser picker, the
 * server's validation and the agent's skill. Adding a name needs a matching entry in the
 * browser's icon catalogue. Spec: modules/dashboard/specs/dashboard-icons.feature.
 */
export const DASHBOARD_ICONS = [
  // Charts and goals
  "layout-dashboard",
  "chart-column",
  "chart-bar",
  "chart-line",
  "chart-area",
  "chart-pie",
  "trending-up",
  "trending-down",
  "activity",
  "gauge",
  "target",
  // Money
  "dollar-sign",
  "coins",
  "wallet",
  "credit-card",
  "receipt",
  "piggy-bank",
  "banknote",
  // People and places
  "users",
  "user",
  "user-check",
  "building-2",
  "briefcase",
  "store",
  // Safety and alerts
  "shield-check",
  "shield-alert",
  "lock",
  "key-round",
  "bell",
  "triangle-alert",
  "circle-alert",
  "siren",
  // Time
  "clock",
  "timer",
  "calendar",
  "hourglass",
  // AI
  "bot",
  "brain",
  "sparkles",
  "cpu",
  "wand-sparkles",
  "message-square",
  "messages-square",
  // Quality and tools
  "zap",
  "rocket",
  "flask-conical",
  "bug",
  "wrench",
  "settings",
  "sliders-horizontal",
  "terminal",
  "code",
  // Infrastructure
  "database",
  "server",
  "cloud",
  "globe",
  "map-pin",
  "network",
  "workflow",
  "git-branch",
  "layers",
  "plug",
  "radio",
  // Things
  "box",
  "package",
  "truck",
  "shopping-cart",
  // General
  "flag",
  "star",
  "bookmark",
  "search",
  "funnel",
  "list-checks",
  "clipboard-list",
  "scroll-text",
  "book-open",
  "lightbulb",
  "flame",
  "award",
  "trophy",
] as const;

const dashboardIconSchemaDefinition = z.enum(DASHBOARD_ICONS);
export interface DashboardIconSchema extends Named<typeof dashboardIconSchemaDefinition> {}
export const dashboardIconSchema: DashboardIconSchema = dashboardIconSchemaDefinition;
export type DashboardIcon = z.infer<typeof dashboardIconSchema>;

/**
 * The icon as the row stores it: `null` is the default board glyph. A name this release does
 * not know (a newer one wrote it) reads as `null` rather than failing the whole board.
 */
const storedDashboardIconSchemaDefinition = dashboardIconSchema.nullable().catch(null);
export interface StoredDashboardIconSchema extends Named<
  typeof storedDashboardIconSchemaDefinition
> {}
export const storedDashboardIconSchema: StoredDashboardIconSchema =
  storedDashboardIconSchemaDefinition;

/** Whether `value` is a name on the allow-list. */
export const isDashboardIcon = (value: unknown): value is DashboardIcon =>
  dashboardIconSchema.validate(value);
