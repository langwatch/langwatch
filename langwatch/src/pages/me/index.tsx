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
import { useState } from "react";
import Head from "~/utils/compat/next-head";

import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";
import { AiToolsPortal } from "~/components/me/AiToolsPortal";
import { BudgetExceededBanner } from "~/components/me/BudgetExceededBanner";
import MyLayout from "~/components/me/MyLayout";
import { PersonalRecentTracesTable } from "~/components/me/PersonalRecentTracesTable";
import { TraceIngestSection } from "~/components/me/TraceIngestSection";
import { usePersonalContext } from "~/components/me/usePersonalContext";

// /me/usage frequently surfaces sub-cent spend; defer to the shared
// gateway formatter so values like $0.000165 don't render as $0.00.
const fmtUsd = (amount: number) => formatBudgetUsd(amount);

const fmtPctDelta = (pct: number | null) =>
  pct === null
    ? null
    : `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct)}% vs last month`;

function MyUsagePage() {
  const ctx = usePersonalContext();
  const {
    summary,
    budget,
    spendByDay,
    spendByTool,
    personalProjectId,
    personalProjectSlug,
    organizationName,
  } = ctx;

  const isOverBudget = budget.status === "exceeded";

  // Two cost series across the spend charts: the theoretical list-price total
  // (includes bundled / not-billed-per-token usage like Claude Max) and the
  // amount actually billed. Each can be toggled off; hiding "theoretical"
  // leaves only real spend. The axis rescales to whichever series is visible
  // so a near-zero billed series still reads at full height on its own.
  const [showTheoretical, setShowTheoretical] = useState(true);
  const [showBilled, setShowBilled] = useState(true);

  const maxDay = Math.max(
    ...spendByDay.map((d) =>
      Math.max(showTheoretical ? d.usd : 0, showBilled ? d.billedUsd : 0),
    ),
    0.01,
  );
  const maxTool = Math.max(
    ...spendByTool.map((t) =>
      Math.max(showTheoretical ? t.usd : 0, showBilled ? t.billedUsd : 0),
    ),
    0.01,
  );

  return (
    <MyLayout>
      <Head>
        <title>My Usage · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full">
        <VStack align="stretch" gap={3}>
          <Heading as="h2" size="lg">
            Your AI tools
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            Pick a tool to get started, or issue a virtual key for your own
            integrations.
          </Text>
          <AiToolsPortal />
        </VStack>

        <TraceIngestSection />

        <HStack alignItems="end" paddingTop={4}>
          <VStack align="start" gap={0}>
            <Heading as="h3" size="md">
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
        {budget.status === "warning" && budget.limitUsd > 0 && (
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
              <CostSeriesLegend
                showTheoretical={showTheoretical}
                showBilled={showBilled}
                onToggleTheoretical={() => setShowTheoretical((v) => !v)}
                onToggleBilled={() => setShowBilled((v) => !v)}
              />
              <HStack gap={1} alignItems="end" height="120px" paddingTop={2}>
                {spendByDay.map((d) => {
                  const theoreticalPct = (d.usd / maxDay) * 100;
                  const billedPct = (d.billedUsd / maxDay) * 100;
                  return (
                    <Box
                      key={d.day}
                      flex={1}
                      position="relative"
                      height="full"
                      title={`${d.day} · theoretical ${fmtUsd(d.usd)} · billed ${fmtUsd(d.billedUsd)}`}
                    >
                      {showTheoretical && (
                        <Box
                          position="absolute"
                          bottom={0}
                          width="full"
                          backgroundColor="purple.300"
                          borderRadius="sm"
                          height={`${Math.max(d.usd > 0 ? 2 : 0, theoreticalPct)}%`}
                        />
                      )}
                      {showBilled && (
                        <Box
                          position="absolute"
                          bottom={0}
                          width="full"
                          backgroundColor="green.500"
                          borderRadius="sm"
                          height={`${Math.max(d.billedUsd > 0 ? 2 : 0, billedPct)}%`}
                        />
                      )}
                    </Box>
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
            <VStack align="stretch" gap={3}>
              <CostSeriesLegend
                showTheoretical={showTheoretical}
                showBilled={showBilled}
                onToggleTheoretical={() => setShowTheoretical((v) => !v)}
                onToggleBilled={() => setShowBilled((v) => !v)}
              />
              {spendByTool.map((tool) => {
                const theoreticalPct = (tool.usd / maxTool) * 100;
                const billedPct = (tool.billedUsd / maxTool) * 100;
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
                      position="relative"
                      title={`theoretical ${fmtUsd(tool.usd)} · billed ${fmtUsd(tool.billedUsd)}`}
                    >
                      {showTheoretical && (
                        <Box
                          position="absolute"
                          left={0}
                          top={0}
                          height="full"
                          width={`${Math.max(tool.usd > 0 ? 2 : 0, theoreticalPct)}%`}
                          backgroundColor="purple.300"
                        />
                      )}
                      {showBilled && (
                        <Box
                          position="absolute"
                          left={0}
                          top={0}
                          height="full"
                          width={`${Math.max(tool.billedUsd > 0 ? 2 : 0, billedPct)}%`}
                          backgroundColor="green.500"
                        />
                      )}
                    </Box>
                    <VStack
                      gap={0}
                      align="end"
                      minWidth="90px"
                      fontSize="sm"
                    >
                      {showTheoretical && (
                        <Text color="fg.muted">{fmtUsd(tool.usd)}</Text>
                      )}
                      {showBilled && tool.billedUsd !== tool.usd && (
                        <Text color="green.600" fontSize="xs">
                          {fmtUsd(tool.billedUsd)} billed
                        </Text>
                      )}
                    </VStack>
                  </HStack>
                );
              })}
            </VStack>
          )}
        </SectionCard>

        <SectionCard title="Recent activity" flushContent>
          {personalProjectId && personalProjectSlug ? (
            <PersonalRecentTracesTable
              projectId={personalProjectId}
              projectSlug={personalProjectSlug}
            />
          ) : (
            <EmptyState message="No requests yet" />
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
  flushContent = false,
}: {
  title: string;
  children: React.ReactNode;
  // When set, the content area spans the full card width (no side padding)
  // and is divided from the title by a top border. Used for an embedded
  // table that should read edge-to-edge while the title stays inset.
  flushContent?: boolean;
}) {
  if (flushContent) {
    return (
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        overflow="hidden"
      >
        <Text
          fontSize="sm"
          fontWeight="semibold"
          paddingX={4}
          paddingTop={4}
          paddingBottom={3}
        >
          {title}
        </Text>
        <Box borderTopWidth="1px" borderTopColor="border.muted">
          {children}
        </Box>
      </Box>
    );
  }

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

// Clickable legend for the two cost series shared by the spend charts.
// Purple = theoretical (list price, includes bundled), green = actually billed.
function CostSeriesLegend({
  showTheoretical,
  showBilled,
  onToggleTheoretical,
  onToggleBilled,
}: {
  showTheoretical: boolean;
  showBilled: boolean;
  onToggleTheoretical: () => void;
  onToggleBilled: () => void;
}) {
  return (
    <HStack gap={4} fontSize="xs">
      <LegendChip
        label="Theoretical"
        color="purple.300"
        active={showTheoretical}
        onClick={onToggleTheoretical}
      />
      <LegendChip
        label="Billed"
        color="green.500"
        active={showBilled}
        onClick={onToggleBilled}
      />
    </HStack>
  );
}

function LegendChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <HStack
      as="button"
      gap={1.5}
      onClick={onClick}
      opacity={active ? 1 : 0.45}
      cursor="pointer"
      _hover={{ opacity: active ? 0.8 : 0.65 }}
      title={active ? `Hide ${label}` : `Show ${label}`}
    >
      <Box width="10px" height="10px" borderRadius="sm" backgroundColor={color} />
      <Text
        color="fg.muted"
        textDecoration={active ? undefined : "line-through"}
      >
        {label}
      </Text>
    </HStack>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(MyUsagePage);
