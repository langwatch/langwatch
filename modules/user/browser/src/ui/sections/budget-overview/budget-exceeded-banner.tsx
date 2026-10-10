import { Link } from "@langwatch/browser-host/link";
import { Alert, HStack, Text } from "@langwatch/design-system/primitives";
import { formatBudgetUsd } from "@langwatch/gateway-contract";
import { ExternalLink, TrendingUp } from "lucide-react";

/**
 * Mirrors the gateway's 402 response and CLI's budget-exceeded rendering.
 * Links are plain anchors for this host-free surface.
 */
export type BudgetExceededBannerProps = {
  /** Total spent in the period that triggered the block. */
  spentUsd: number;
  /** Hard limit the spend exceeded. */
  limitUsd: number;
  /** Period the limit applies to: "monthly" | "weekly" | "daily" | "session". */
  period: string;
  /** Scope of the binding budget: "user" | "team" | "project" | "organization" | "virtual_key". */
  scope: string;
  /**
   * Pre-signed deep link to the request-increase flow on /me/configure.
   * Optional — when absent, the banner falls back to a static
   * "ask your admin" message without the CTA.
   */
  requestIncreaseUrl?: string | null;
  /** Admin email surfaced in the "ask your admin" copy. Optional. */
  adminEmail?: string | null;
};

// Admin contact is free text: admins can set Organization.supportContact
// to an email, a URL pointing at an internal ticketing system, or any
// short instruction. The banner renders an actionable link when the
// value parses as a URL, a mailto: when it parses as an email, and
// plain text otherwise. Resolver: server/organizations/resolveSupportContact.
function isUrlContact(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
function stripMailto(value: string): string {
  return value.replace(/^mailto:/i, "");
}
function isEmailContact(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stripMailto(value.trim()));
}
function contactHref(value: string): string {
  const trimmed = value.trim();
  if (isUrlContact(trimmed)) return trimmed;
  if (isEmailContact(trimmed)) return `mailto:${stripMailto(trimmed)}`;
  return "#";
}

// `api.gatewayBudgets.personalBudget` and the gateway 402 payload both pass
// `period` as the lowercased root form of the `GatewayBudgetWindow`
// Prisma enum ("month" / "week" / "day" / "hour" / "minute" / "total").
// Map to adjective form for display; also accept the adjective forms
// directly so older callers / hand-written fixtures still render.
const PERIOD_LABEL: Record<string, string> = {
  minute: "per-minute",
  hour: "hourly",
  day: "daily",
  week: "weekly",
  month: "monthly",
  total: "total",
  monthly: "monthly",
  weekly: "weekly",
  daily: "daily",
  hourly: "hourly",
  session: "session",
};

const SCOPE_LABEL: Record<string, string> = {
  user: "personal",
  virtual_key: "personal",
  // Scope classes from `api.governance.budgetOverview`, already user-relative.
  personal: "personal",
  key: "personal",
  department: "department",
  principal: "personal",
  group: "department",
  team: "team",
  project: "project",
  organization: "organization",
};

// Defer to the shared gateway formatter so sub-cent gpt-5-mini-class
// spend renders with micro-precision instead of getting truncated to
// $0.00 by Intl.NumberFormat's 2-decimal default.
function fmtUsd(n: number): string {
  return formatBudgetUsd(n);
}

export function BudgetExceededBanner({
  spentUsd,
  limitUsd,
  period,
  scope,
  requestIncreaseUrl,
  adminEmail,
}: BudgetExceededBannerProps) {
  const periodLabel = PERIOD_LABEL[period.toLowerCase()] ?? period;
  const scopeLabel = SCOPE_LABEL[scope.toLowerCase()] ?? scope;

  return (
    <Alert.Root status="error" role="alert" aria-live="assertive">
      <Alert.Indicator />
      <Alert.Content gap={2}>
        <Alert.Title>Budget limit reached</Alert.Title>
        <Alert.Description>
          You&rsquo;ve used <strong>{fmtUsd(spentUsd)}</strong> of your{" "}
          <strong>{fmtUsd(limitUsd)}</strong> {periodLabel} {scopeLabel} budget. New requests are
          being blocked until the limit resets or your admin raises it.
        </Alert.Description>
        {(requestIncreaseUrl || adminEmail) && (
          <HStack gap={4} fontSize="sm" wrap="wrap">
            {requestIncreaseUrl && (
              <Link href={requestIncreaseUrl} fontWeight="medium">
                <HStack gap={1}>
                  <TrendingUp size={14} aria-hidden="true" />
                  <Text>Request increase</Text>
                  <ExternalLink size={12} aria-hidden="true" />
                </HStack>
              </Link>
            )}
            {adminEmail && (
              <Text>
                Admin:{" "}
                {isUrlContact(adminEmail) || isEmailContact(adminEmail) ? (
                  <Link
                    href={contactHref(adminEmail)}
                    {...(isUrlContact(adminEmail) && {
                      target: "_blank",
                      rel: "noreferrer",
                    })}
                  >
                    {adminEmail}
                  </Link>
                ) : (
                  <Text as="span">{adminEmail}</Text>
                )}
              </Text>
            )}
          </HStack>
        )}
      </Alert.Content>
    </Alert.Root>
  );
}
