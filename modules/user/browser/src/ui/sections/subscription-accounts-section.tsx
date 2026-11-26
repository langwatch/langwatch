import type { CodingAgentAccountBurndown } from "@langwatch/coding-agent-contract";
import { Card } from "@langwatch/design-system/card";
import { Chip } from "@langwatch/design-system/chip";
import { DailyBarChart } from "@langwatch/design-system/daily-bar-chart";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { HStack, SimpleGrid, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { formatBudgetUsd } from "@langwatch/gateway-contract";
import { docsUrl } from "@langwatch/handled-error/docs-url";
import { nowEpochMs } from "@langwatch/time";
import { KeyRound } from "lucide-react";
import numeral from "numeral";
import { useEffect, useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import {
  accountSourceLabel,
  agentLabel,
  cumulativeTokens,
  formatAccountDay,
  formatAccountMoment,
  formatLimitMoment,
  formatUsagePercent,
  usageWindowLabel,
} from "../../model/coding-agent/account-burndown.ts";

const DOCS_PATH = "/coding-agents/usage-analytics#subscription-accounts";

/**
 * This week per subscription account: what its sessions spent, and the usage the account itself
 * reported. Spec: specs/coding-agent/account-burndown.feature.
 */
export function SubscriptionAccountsSection({ projectId }: { projectId: string }) {
  const query = api.codingAgents.accountBurndown.useQuery(
    { projectId },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );

  return (
    <Card
      title="Subscription accounts"
      description="What each account spent this week, and how much of its limit the provider says it used."
      data-testid="subscription-accounts"
    >
      <SubscriptionAccountsBody query={query} />
    </Card>
  );
}

function SubscriptionAccountsBody({
  query,
}: {
  query: {
    isLoading: boolean;
    isError: boolean;
    error?: unknown;
    data?: { accounts: CodingAgentAccountBurndown[] };
    refetch: () => unknown;
  };
}) {
  if (query.isLoading) {
    return (
      <SimpleGrid columns={{ base: 1, lg: 3 }} gap={3}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height="220px" borderRadius="md" />
        ))}
      </SimpleGrid>
    );
  }
  if (query.isError && query.data === undefined) {
    return (
      <HandledErrorAlert
        error={query.error}
        fallbackTitle="Couldn't load subscription accounts"
        onRetry={() => void query.refetch()}
      />
    );
  }
  const accounts = query.data?.accounts ?? [];
  if (accounts.length === 0) {
    return (
      <NoDataInfoBlock
        size="inline"
        bordered={false}
        icon={<KeyRound />}
        title="No subscription accounts this week"
        description="Claude Code and Codex send the account they run on. A launcher can name it with the langwatch.account attributes."
        next={[{ kind: "docs", label: "Subscription accounts", href: docsUrl(DOCS_PATH) }]}
      />
    );
  }

  return (
    <VStack align="stretch" gap={3}>
      {query.isError && (
        <HandledErrorAlert
          error={query.error}
          fallbackTitle="Couldn't refresh subscription accounts"
          onRetry={() => void query.refetch()}
        />
      )}
      <SimpleGrid columns={{ base: 1, lg: Math.min(3, accounts.length) }} gap={3}>
        {accounts.map((account) => (
          <AccountCard key={account.accountId} account={account} />
        ))}
      </SimpleGrid>
      <Text fontSize="xs" color="fg.muted">
        The usage percent is what the provider reported for each account. LangWatch does not
        estimate it from tokens.
      </Text>
    </VStack>
  );
}

/** The limit's end while it is still ahead; re-renders when it passes so the badge goes away. */
function useActiveLimit(limitedUntilMs: number | null): number | null {
  const [nowMs, setNowMs] = useState(nowEpochMs);
  const isActive = limitedUntilMs !== null && limitedUntilMs > nowMs;
  useEffect(() => {
    if (!isActive || limitedUntilMs === null) return;
    const timer = setTimeout(() => setNowMs(nowEpochMs()), limitedUntilMs - nowMs + 1000);
    return () => clearTimeout(timer);
  }, [isActive, limitedUntilMs, nowMs]);

  return isActive ? limitedUntilMs : null;
}

function AccountCard({ account }: { account: CodingAgentAccountBurndown }) {
  const about = [
    account.agents.map(agentLabel).join(", "),
    account.topModels[0],
    accountSourceLabel(account.source),
  ].filter((part): part is string => Boolean(part));
  const limitedUntilMs = useActiveLimit(account.reading?.limitedUntilMs ?? null);

  return (
    <Card
      variant="nested"
      borderTone="muted"
      title={account.name}
      titleLevel={3}
      description={about.join(" · ")}
      badge={
        limitedUntilMs !== null ? (
          <Chip
            tone="red"
            value={`Out of usage until ${formatLimitMoment(limitedUntilMs, nowEpochMs())}`}
          />
        ) : undefined
      }
      badgePlacement="end"
      bodyLayout="spaced"
      data-testid="subscription-account"
    >
      <UsageReading account={account} />
      <WeekTokens account={account} />
    </Card>
  );
}

function UsageReading({ account }: { account: CodingAgentAccountBurndown }) {
  const reading = account.reading;
  const percent = reading?.percent ?? null;
  const when = [
    reading?.readAtMs ? `As of ${formatAccountMoment(reading.readAtMs)}` : null,
    reading?.resetsAtMs ? `Resets ${formatAccountMoment(reading.resetsAtMs)}` : null,
  ].filter((part): part is string => part !== null);
  if (reading === null || percent === null) {
    return (
      <VStack align="stretch" gap={1}>
        <Text fontSize="sm" color="fg.muted">
          No usage figure reported yet
        </Text>
        {when.length > 0 && (
          <Text fontSize="xs" color="fg.muted">
            {when.join(" · ")}
          </Text>
        )}
      </VStack>
    );
  }
  const window = usageWindowLabel(reading.window);

  return (
    <VStack align="stretch" gap={1.5}>
      <HStack justify="space-between" align="baseline">
        <Text textStyle="2xl" fontWeight="semibold" fontVariantNumeric="tabular-nums">
          {formatUsagePercent(percent)}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {window ? `of the ${window} used` : "used"}
        </Text>
      </HStack>
      <MeterBar
        width="full"
        height="6px"
        fillRatio={percent / 100}
        fillColor={meterColor(percent)}
        data-testid="subscription-account-meter"
      />
      {when.length > 0 && (
        <Text fontSize="xs" color="fg.muted">
          {when.join(" · ")}
        </Text>
      )}
    </VStack>
  );
}

function meterColor(percent: number): string {
  if (percent >= 90) return "red.solid";
  if (percent >= 70) return "orange.solid";
  return "blue.solid";
}

function WeekTokens({ account }: { account: CodingAgentAccountBurndown }) {
  const running = cumulativeTokens(account.days);
  const first = account.days[0];
  const last = account.days.at(-1);
  const bars = account.days.map((day, index) => ({
    value: running[index] ?? 0,
    title: `${formatAccountDay(day.day)}: ${numeral(running[index] ?? 0).format("0,0")} tokens so far`,
  }));

  return (
    <VStack align="stretch" gap={2}>
      <Text fontSize="xs" color="fg.muted">
        Tokens so far this week
      </Text>
      <DailyBarChart
        bars={bars}
        axis={first && last ? [formatAccountDay(first.day), formatAccountDay(last.day)] : []}
        summary={`${numeral(account.totals.totalTokens).format("0,0")} tokens this week`}
        height="56px"
        colorPalette="blue"
        data-testid="subscription-account-chart"
      />
      <HStack justify="space-between" fontSize="sm">
        <Text>
          <Text as="span" fontWeight="semibold">
            {numeral(account.totals.totalTokens).format("0.0a").toUpperCase()}
          </Text>{" "}
          tokens
        </Text>
        {account.totals.costUsd !== null && (
          <Text fontWeight="semibold">{formatBudgetUsd(account.totals.costUsd)}</Text>
        )}
      </HStack>
      {account.rateLimitEvents > 0 && (
        <Text fontSize="xs" color="fg.muted">
          {account.rateLimitEvents} rate limit {account.rateLimitEvents === 1 ? "event" : "events"}{" "}
          this week
        </Text>
      )}
    </VStack>
  );
}
