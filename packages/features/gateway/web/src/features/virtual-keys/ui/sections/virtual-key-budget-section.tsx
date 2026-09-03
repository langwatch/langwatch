import { Badge, Box, HStack, Input, NativeSelect, Spacer, Text, VStack } from "@chakra-ui/react";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { api } from "../../../../behavior/gateway-api";
import { SmallLabel } from "@langwatch/design-system/small-label";
import type { ScopeTriadEntry } from "@langwatch/authz-web/surfaces/scope-picker";
import { formatBudgetUsd } from "../../../../model/format-budget-usd";

export type VirtualKeyBudgetWindow = "DAY" | "WEEK" | "MONTH";

export type VirtualKeyBudgetValue = {
  /** Empty string = no budget on this key. */
  limitUsd: string;
  window: VirtualKeyBudgetWindow;
};

export const EMPTY_BUDGET: VirtualKeyBudgetValue = {
  limitUsd: "",
  window: "DAY",
};

function formatLimit(limitUsd: string): string {
  const n = Number.parseFloat(limitUsd);
  if (!Number.isFinite(n)) return limitUsd;
  // Whole dollars stay bare ("Max $30/day"); fractional caps go through
  // the shared budget formatter so a $0.005 cap does not round up to the
  // doubled "Max $0.01/day". The annotation supplies its own dollar sign.
  return Number.isInteger(n) ? `${n}` : formatBudgetUsd(n).replace(/^\$/, "");
}

/**
 * The one deliberately visible line on this form. "Resets at midnight" is
 * a different promise in each timezone, and the wrong assumption is only
 * discovered by being billed; so the reset instant and its timezone are
 * spelled out instead of tucked behind a tooltip. Enforcement computes
 * resets in UTC only (budgetWindow.ts), so the copy always says UTC; the
 * drawer offers a timezone choice again once enforcement honors one.
 */
export function budgetAnnotation(value: VirtualKeyBudgetValue): string {
  if (!value.limitUsd.trim()) return "No max spending for this key";
  const limit = formatLimit(value.limitUsd);
  switch (value.window) {
    case "DAY":
      return `Max $${limit}/day, resets 00:00 UTC`;
    case "WEEK":
      return `Max $${limit}/week, resets Monday 00:00 UTC`;
    case "MONTH":
      return `Max $${limit}/month, resets on the 1st 00:00 UTC`;
  }
}

/**
 * Positive decimal or empty; anything else blocks save. The regex, not
 * parseFloat alone, is what rejects partial parses like "10abc": the
 * whole trimmed string must be the number.
 */
export function budgetInvalidReason(value: VirtualKeyBudgetValue): string | null {
  const trimmed = value.limitUsd.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return "Budget must be a positive amount.";
  }
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    return "Budget must be a positive amount.";
  }
  return null;
}

/**
 * Budget field for the virtual-key drawers: a dollar amount, a period,
 * the visible reset annotation, and the list of budgets that already
 * constrain this key.
 */
export function VirtualKeyBudgetSection({
  value,
  onChange,
  organizationId,
  scopes,
  traceProjectId,
  principalUserId,
  virtualKeyId,
}: {
  value: VirtualKeyBudgetValue;
  onChange: (next: VirtualKeyBudgetValue) => void;
  organizationId: string;
  /** The draft key's scopes; these decide which budgets already apply. */
  scopes: ScopeTriadEntry[];
  /** Explicit trace destination of org- and team-owned drafts. */
  traceProjectId?: string | null;
  principalUserId?: string | null;
  /** Set in the edit drawer so its own key-targeted budget is not listed twice. */
  virtualKeyId?: string | null;
}) {
  return (
    <VStack align="start" width="full" gap={1.5}>
      <HStack gap={1} alignItems="center">
        <SmallLabel>Budget</SmallLabel>
        <FieldInfoTooltip
          description="The most this key may spend per period. Enforced by the gateway: once the limit is reached, requests through this key are refused until the period resets. Leave empty for no cap on the key itself; budgets on the organization, team, project or your account still apply."
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
                window: (e.target.value as VirtualKeyBudgetWindow) ?? "DAY",
              })
            }
          >
            <option value="DAY">per day</option>
            <option value="WEEK">per week</option>
            <option value="MONTH">per month</option>
          </NativeSelect.Field>
        </NativeSelect.Root>
      </HStack>
      <Text
        fontSize="xs"
        color={value.limitUsd.trim() ? "fg" : "fg.muted"}
        data-testid="vk-budget-annotation"
      >
        {budgetAnnotation(value)}
      </Text>

      <ApplicableBudgetsList
        organizationId={organizationId}
        scopes={scopes}
        traceProjectId={traceProjectId}
        principalUserId={principalUserId}
        virtualKeyId={virtualKeyId}
      />
    </VStack>
  );
}

/**
 * The budgets that would already constrain this key, resolved by the
 * same service the gateway enforces from, so the list cannot promise a
 * constraint that will not apply, or miss one that will.
 */
function ApplicableBudgetsList({
  organizationId,
  scopes,
  traceProjectId,
  principalUserId,
  virtualKeyId,
}: {
  organizationId: string;
  scopes: ScopeTriadEntry[];
  traceProjectId?: string | null;
  principalUserId?: string | null;
  virtualKeyId?: string | null;
}) {
  const query = api.virtualKeys.applicableBudgets.useQuery(
    {
      organizationId,
      scopes,
      traceProjectId: traceProjectId ?? null,
      principalUserId: principalUserId ?? null,
      virtualKeyId: virtualKeyId ?? null,
    },
    { enabled: !!organizationId && scopes.length > 0 },
  );

  // Only the drawer-managed budget hides from this list (it IS the field
  // above); an independently created key-targeted cap is an inherited
  // constraint like any other and must stay visible.
  const rows = (query.data ?? []).filter(
    (b) => !(virtualKeyId && b.managedByVirtualKeyId === virtualKeyId),
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
          {b.isPerMember && (
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
