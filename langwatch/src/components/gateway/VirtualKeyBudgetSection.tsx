import {
  Badge,
  Box,
  Button,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";

import { SmallLabel } from "../SmallLabel";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { api } from "~/utils/api";

import { formatBudgetUsd } from "./formatBudgetUsd";
import type { ScopeTriadEntry } from "../settings/ScopeChipPicker";

export type VirtualKeyBudgetWindow = "DAY" | "WEEK" | "MONTH";

export type VirtualKeyBudgetValue = {
  /** Empty string = no budget on this key. */
  limitUsd: string;
  window: VirtualKeyBudgetWindow;
  /** Null = the default reset timezone (UTC). */
  timezone: string | null;
};

export const EMPTY_BUDGET: VirtualKeyBudgetValue = {
  limitUsd: "",
  window: "DAY",
  timezone: null,
};

const WINDOW_WORD: Record<VirtualKeyBudgetWindow, string> = {
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
};

function formatLimit(limitUsd: string): string {
  const n = Number.parseFloat(limitUsd);
  if (!Number.isFinite(n)) return limitUsd;
  return Number.isInteger(n) ? `${n}` : n.toFixed(2);
}

/**
 * The one deliberately visible line on this form. "Resets at midnight" is
 * a different promise in each timezone, and the wrong assumption is only
 * discovered by being billed — so the reset instant and its timezone are
 * spelled out instead of tucked behind a tooltip.
 */
export function budgetAnnotation(value: VirtualKeyBudgetValue): string {
  if (!value.limitUsd.trim()) return "No max spending for this key";
  const tz = value.timezone ?? "UTC";
  const limit = formatLimit(value.limitUsd);
  switch (value.window) {
    case "DAY":
      return `Max $${limit}/day, resets 00:00 ${tz}`;
    case "WEEK":
      return `Max $${limit}/week, resets Monday 00:00 ${tz}`;
    case "MONTH":
      return `Max $${limit}/month, resets on the 1st 00:00 ${tz}`;
  }
}

/** Positive number or empty; anything else blocks save. */
export function budgetInvalidReason(
  value: VirtualKeyBudgetValue,
): string | null {
  if (!value.limitUsd.trim()) return null;
  const n = Number.parseFloat(value.limitUsd);
  if (!Number.isFinite(n) || n <= 0) {
    return "Budget must be a positive amount.";
  }
  return null;
}

function timezoneOptions(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {
    // Fall through to the minimal list.
  }
  return [
    "UTC",
    "America/New_York",
    "America/Los_Angeles",
    "Europe/Amsterdam",
    "Europe/London",
    "Asia/Tokyo",
  ];
}

/**
 * Budget field for the virtual-key drawers: a dollar amount, a period,
 * the visible reset annotation, an expandable timezone override, and the
 * list of budgets that already constrain this key.
 */
export function VirtualKeyBudgetSection({
  value,
  onChange,
  organizationId,
  scopes,
  principalUserId,
  virtualKeyId,
}: {
  value: VirtualKeyBudgetValue;
  onChange: (next: VirtualKeyBudgetValue) => void;
  organizationId: string;
  /** The draft key's scopes — what decides which budgets already apply. */
  scopes: ScopeTriadEntry[];
  principalUserId?: string | null;
  /** Set in the edit drawer so its own key-targeted budget is not listed twice. */
  virtualKeyId?: string | null;
}) {
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const zones = useMemo(timezoneOptions, []);

  return (
    <VStack align="start" width="full" gap={1.5}>
      <HStack gap={1} alignItems="center">
        <SmallLabel>Budget</SmallLabel>
        <FieldInfoTooltip
          description="The most this key may spend per period. Enforced by the gateway: once the limit is reached, requests through this key are refused until the period resets. Leave empty for no cap on the key itself — budgets on the organization, team, project or your account still apply."
          docHref="/ai-gateway/budgets"
          testId="vk-budget-info"
        />
      </HStack>
      <HStack gap={2} width="full" maxWidth="340px">
        <Box position="relative" flex={1}>
          <Text
            position="absolute"
            left={3}
            top="50%"
            transform="translateY(-50%)"
            color="fg.muted"
            fontSize="sm"
            pointerEvents="none"
          >
            $
          </Text>
          <Input
            value={value.limitUsd}
            onChange={(e) => onChange({ ...value, limitUsd: e.target.value })}
            placeholder="No limit"
            inputMode="decimal"
            paddingLeft={7}
            aria-label="Budget limit in USD"
            data-testid="vk-budget-limit"
          />
        </Box>
        <NativeSelect.Root size="md" width="140px">
          <NativeSelect.Field
            value={value.window}
            aria-label="Budget period"
            data-testid="vk-budget-window"
            onChange={(e) =>
              onChange({
                ...value,
                window:
                  (e.target.value as VirtualKeyBudgetWindow) ?? "DAY",
              })
            }
          >
            <option value="DAY">per day</option>
            <option value="WEEK">per week</option>
            <option value="MONTH">per month</option>
          </NativeSelect.Field>
        </NativeSelect.Root>
      </HStack>
      <HStack gap={1.5} alignItems="baseline">
        <Text
          fontSize="xs"
          color={value.limitUsd.trim() ? "fg" : "fg.muted"}
          data-testid="vk-budget-annotation"
        >
          {budgetAnnotation(value)}
        </Text>
        {value.limitUsd.trim() && (
          <Button
            type="button"
            variant="ghost"
            size="2xs"
            color="fg.muted"
            fontSize="xs"
            height="auto"
            paddingX={1}
            paddingY={0}
            onClick={() => setCustomizeOpen((open) => !open)}
            data-testid="vk-budget-customize-reset"
          >
            Customize
          </Button>
        )}
      </HStack>
      {value.limitUsd.trim() && customizeOpen && (
        <NativeSelect.Root size="sm" maxWidth="340px">
          <NativeSelect.Field
            value={value.timezone ?? ""}
            aria-label="Reset timezone"
            data-testid="vk-budget-timezone"
            onChange={(e) =>
              onChange({
                ...value,
                timezone: e.target.value || null,
              })
            }
          >
            <option value="">UTC (default)</option>
            {zones
              .filter((z) => z !== "UTC")
              .map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
          </NativeSelect.Field>
        </NativeSelect.Root>
      )}

      <ApplicableBudgetsList
        organizationId={organizationId}
        scopes={scopes}
        principalUserId={principalUserId}
        virtualKeyId={virtualKeyId}
      />
    </VStack>
  );
}

/**
 * The budgets that would already constrain this key — resolved by the
 * same service the gateway enforces from, so the list cannot promise a
 * constraint that will not apply, or miss one that will.
 */
function ApplicableBudgetsList({
  organizationId,
  scopes,
  principalUserId,
  virtualKeyId,
}: {
  organizationId: string;
  scopes: ScopeTriadEntry[];
  principalUserId?: string | null;
  virtualKeyId?: string | null;
}) {
  const query = api.virtualKeys.applicableBudgets.useQuery(
    {
      organizationId,
      scopes,
      principalUserId: principalUserId ?? null,
      virtualKeyId: virtualKeyId ?? null,
    },
    { enabled: !!organizationId && scopes.length > 0 },
  );

  const rows = (query.data ?? []).filter(
    (b) => !(b.scopeType === "VIRTUAL_KEY" && b.scopeId === virtualKeyId),
  );
  if (rows.length === 0) return null;

  return (
    <VStack
      align="stretch"
      width="full"
      gap={0}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      marginTop={1}
      data-testid="vk-applicable-budgets"
    >
      <Text
        fontSize="2xs"
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wide"
        paddingX={2.5}
        paddingTop={2}
      >
        Inherited budgets
      </Text>
      {rows.map((b) => (
        <HStack
          key={b.id}
          paddingX={2.5}
          paddingY={1.5}
          gap={2}
          fontSize="xs"
          _notLast={{ borderBottomWidth: "1px", borderColor: "border.subtle" }}
        >
          <Text fontWeight="medium" lineClamp={1}>
            {b.scopeLabel}
          </Text>
          {b.providerLabel && (
            <Badge variant="subtle" colorPalette="blue" fontSize="2xs">
              {b.providerLabel} only
            </Badge>
          )}
          {b.perMember && (
            <Badge variant="subtle" colorPalette="cyan" fontSize="2xs">
              per member
            </Badge>
          )}
          <Spacer />
          <Text color="fg.muted" whiteSpace="nowrap">
            {formatBudgetUsd(b.spentUsd)} of {formatBudgetUsd(b.limitUsd)} /{" "}
            {b.window.toLowerCase()}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}
