import {
  Box,
  Heading,
  HStack,
  SimpleGrid,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import Head from "~/utils/compat/next-head";

import { BudgetExceededBanner } from "~/components/me/BudgetExceededBanner";
import MyLayout from "~/components/me/MyLayout";
import { usePersonalContext } from "~/components/me/usePersonalContext";

const fmtUsd = (amount: number) =>
  amount === 0 ? "$0.00" : numeral(amount).format("$0,0.00");

const fmtPctDelta = (pct: number | null) =>
  pct === null
    ? null
    : `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct)}% vs last month`;

export default function MyUsagePage() {
  const ctx = usePersonalContext();
  const {
    summary,
    budget,
    spendByDay,
    spendByTool,
    recentActivity,
    organizationName,
  } = ctx;

  const isOverBudget = budget.status === "exceeded";
  const is80Pct = budget.status === "warning";

  const maxDay = Math.max(...spendByDay.map((d) => d.usd), 0.01);
  const maxTool = Math.max(...spendByTool.map((t) => t.usd), 0.01);

  return (
    <MyLayout>
      <Head>
        <title>My Usage · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full">
        <HStack alignItems="end">
          <VStack align="start" gap={0}>
            <Heading as="h2" size="lg">
              My Usage
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Your AI usage in {organizationName} this month
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        {budget.status === "exceeded" && (
          <BudgetExceededBanner
            spentUsd={budget.spentUsd}
            limitUsd={budget.limitUsd}
            period={budget.period}
            scope={budget.scope}
            requestIncreaseUrl={budget.requestIncreaseUrl}
            adminEmail={budget.adminEmail}
          />
        )}
        {budget.status === "warning" && (
          <BudgetBanner
            tone="yellow"
            title="Approaching budget"
            message={`You've used ${Math.round((budget.spentUsd / budget.limitUsd) * 100)}% of your ${budget.period} ${budget.scope} budget.`}
          />
        )}

        <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
          <SummaryCard
            title="Spent this month"
            value={fmtUsd(summary.spentThisMonthUsd)}
            subline={
              isOverBudget
                ? "Limit reached"
                : summary.budgetUsd !== null
                  ? `of ${fmtUsd(summary.budgetUsd)} budget`
                  : "No budget set"
            }
            tone={isOverBudget ? "red" : "default"}
          />
          <SummaryCard
            title="Requests this month"
            value={numeral(summary.requestsThisMonth).format("0,0")}
            subline={fmtPctDelta(summary.requestsDeltaPctVsLastMonth) ?? "—"}
          />
          <SummaryCard
            title="Most-used model"
            value={summary.mostUsedModel?.name ?? "—"}
            subline={
              summary.mostUsedModel
                ? `${summary.mostUsedModel.usagePct}% of usage`
                : "Run a request to see this"
            }
          />
        </SimpleGrid>

        <SectionCard title="Spending over time">
          {spendByDay.length === 0 ? (
            <EmptyState
              message="No usage yet"
              hint="Run `langwatch claude` to get started"
            />
          ) : (
            <VStack align="stretch" gap={2}>
              <HStack
                gap={1}
                alignItems="end"
                height="120px"
                paddingTop={2}
              >
                {spendByDay.map((d) => {
                  const heightPct = (d.usd / maxDay) * 100;
                  return (
                    <Box
                      key={d.day}
                      flex={1}
                      backgroundColor="blue.400"
                      _hover={{ backgroundColor: "blue.500" }}
                      borderRadius="sm"
                      height={`${Math.max(2, heightPct)}%`}
                      title={`${d.day} · ${fmtUsd(d.usd)}`}
                    />
                  );
                })}
              </HStack>
              <HStack justifyContent="space-between" fontSize="xs" color="fg.muted">
                <Text>{spendByDay[0]?.day}</Text>
                <Text>{spendByDay[spendByDay.length - 1]?.day}</Text>
              </HStack>
            </VStack>
          )}
        </SectionCard>

        <SectionCard title="By tool">
          {spendByTool.length === 0 ? (
            <EmptyState message="No tool data yet" />
          ) : (
            <VStack align="stretch" gap={2}>
              {spendByTool.map((tool) => {
                const widthPct = (tool.usd / maxTool) * 100;
                return (
                  <HStack key={tool.tool} gap={3}>
                    <Text fontSize="sm" minWidth="120px">
                      {tool.tool}
                    </Text>
                    <Box
                      flex={1}
                      height="14px"
                      backgroundColor="bg.muted"
                      borderRadius="sm"
                      overflow="hidden"
                    >
                      <Box
                        height="full"
                        width={`${Math.max(2, widthPct)}%`}
                        backgroundColor="purple.400"
                      />
                    </Box>
                    <Text fontSize="sm" color="fg.muted" minWidth="80px" textAlign="right">
                      {fmtUsd(tool.usd)}
                    </Text>
                  </HStack>
                );
              })}
            </VStack>
          )}
        </SectionCard>

        <SectionCard title="Recent activity">
          {recentActivity.length === 0 ? (
            <EmptyState message="No requests yet" />
          ) : (
            <VStack align="stretch" gap={1}>
              {recentActivity.map((row) => (
                <HStack
                  key={row.id}
                  paddingY={2}
                  paddingX={2}
                  borderRadius="sm"
                  _hover={{ backgroundColor: "bg.muted" }}
                  fontSize="sm"
                >
                  <Text minWidth="60px" color="fg.muted" fontVariantNumeric="tabular-nums">
                    {row.occurredAt}
                  </Text>
                  <Text minWidth="80px" fontWeight="medium">
                    {row.toolName}
                  </Text>
                  <Text flex={1} color="fg.muted" truncate>
                    {row.summary}
                  </Text>
                  <Text minWidth="80px" textAlign="right" fontVariantNumeric="tabular-nums">
                    {fmtUsd(row.costUsd)}
                  </Text>
                </HStack>
              ))}
            </VStack>
          )}
        </SectionCard>
      </VStack>
    </MyLayout>
  );
}

function SummaryCard({
  title,
  value,
  subline,
  tone = "default",
}: {
  title: string;
  value: string;
  subline: string;
  tone?: "default" | "red";
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
      backgroundColor="bg.subtle"
    >
      <Text fontSize="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
        {title}
      </Text>
      <Text
        fontSize="2xl"
        fontWeight="semibold"
        marginTop={1}
        color={tone === "red" ? "red.500" : "fg"}
      >
        {value}
      </Text>
      <Text fontSize="sm" color={tone === "red" ? "red.500" : "fg.muted"} marginTop={1}>
        {subline}
      </Text>
    </Box>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
    >
      <Text fontSize="sm" fontWeight="semibold" marginBottom={3}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function BudgetBanner({
  tone,
  title,
  message,
}: {
  tone: "red" | "yellow";
  title: string;
  message: string;
}) {
  const colors =
    tone === "red"
      ? { bg: "red.50", border: "red.200", title: "red.700", text: "red.700" }
      : { bg: "yellow.50", border: "yellow.200", title: "yellow.800", text: "yellow.800" };

  return (
    <Box
      borderWidth="1px"
      borderColor={colors.border}
      backgroundColor={colors.bg}
      borderRadius="md"
      padding={4}
    >
      <Text fontWeight="semibold" color={colors.title}>
        {title}
      </Text>
      <Text fontSize="sm" color={colors.text} marginTop={1}>
        {message}
      </Text>
    </Box>
  );
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <VStack align="center" justifyContent="center" paddingY={6} gap={1}>
      <Text fontSize="sm" color="fg.muted">
        {message}
      </Text>
      {hint && (
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      )}
    </VStack>
  );
}
