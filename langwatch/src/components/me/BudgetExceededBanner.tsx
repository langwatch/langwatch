import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, ExternalLink, TrendingUp } from "lucide-react";
import React from "react";

import { Link } from "../ui/link";

/**
 * Wire shape matches the 402 body that the gateway returns and
 * `services/cli/internal/wrapper/budget.go::CheckBudget` (now ported to
 * `typescript-sdk/src/cli/utils/governance/budget.ts`) consumes. The CLI
 * renders a bordered ASCII box with these same fields; this component
 * renders the equivalent Chakra banner so the cross-surface UX is
 * consistent end-to-end.
 *
 * Spec: specs/ai-gateway/governance/budget-exceeded.feature
 *       (web banner mirrors the CLI Screen 8 storyboard from gateway.md)
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
   * Pre-signed deep link to the request-increase flow on /me/settings.
   * Optional — when absent, the banner falls back to a static
   * "ask your admin" message without the CTA.
   */
  requestIncreaseUrl?: string | null;
  /** Admin email surfaced in the "ask your admin" copy. Optional. */
  adminEmail?: string | null;
};

// `api.user.personalBudget` and the gateway 402 payload both pass
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
  team: "team",
  project: "project",
  organization: "organization",
};

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
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
    <Box
      role="alert"
      aria-live="assertive"
      borderWidth="1px"
      borderColor="red.300"
      backgroundColor="red.50"
      borderRadius="md"
      padding={4}
      _dark={{ borderColor: "red.700", backgroundColor: "red.900" }}
    >
      <HStack gap={3} alignItems="start">
        <Box
          color="red.600"
          paddingTop="2px"
          _dark={{ color: "red.300" }}
        >
          <AlertTriangle size={20} aria-hidden="true" />
        </Box>
        <VStack align="start" gap={2} flex={1}>
          <Text
            fontWeight="semibold"
            color="red.700"
            _dark={{ color: "red.200" }}
          >
            Budget limit reached
          </Text>
          <Text
            fontSize="sm"
            color="red.700"
            _dark={{ color: "red.200" }}
          >
            You&rsquo;ve used <strong>{fmtUsd(spentUsd)}</strong> of your{" "}
            <strong>{fmtUsd(limitUsd)}</strong> {periodLabel} {scopeLabel} budget.
            New requests are being blocked until the limit resets or your admin
            raises it.
          </Text>
          {(requestIncreaseUrl || adminEmail) && (
            <HStack gap={4} fontSize="sm" wrap="wrap">
              {requestIncreaseUrl && (
                <Link
                  href={requestIncreaseUrl}
                  color="red.700"
                  fontWeight="medium"
                  _dark={{ color: "red.200" }}
                >
                  <HStack gap={1}>
                    <TrendingUp size={14} aria-hidden="true" />
                    <Text>Request increase</Text>
                    <ExternalLink size={12} aria-hidden="true" />
                  </HStack>
                </Link>
              )}
              {adminEmail && (
                <Text color="red.700" _dark={{ color: "red.200" }}>
                  Admin:{" "}
                  <Link
                    href={`mailto:${adminEmail}`}
                    color="red.700"
                    _dark={{ color: "red.200" }}
                  >
                    {adminEmail}
                  </Link>
                </Text>
              )}
            </HStack>
          )}
        </VStack>
      </HStack>
    </Box>
  );
}
