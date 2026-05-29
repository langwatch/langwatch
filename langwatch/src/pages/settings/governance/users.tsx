import {
  Box,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import { useRouter } from "~/utils/compat/next-router";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { getHexColorForString } from "~/utils/rotatingColors";

type SpendByUser = RouterOutputs["activityMonitor"]["spendByUser"][number];
type SortField = "spend" | "requests" | "lastActivity";

const SORT_LABEL: Record<SortField, string> = {
  spend: "spend",
  requests: "requests",
  lastActivity: "last activity",
};

function isSortField(v: string | string[] | undefined): v is SortField {
  return v === "spend" || v === "requests" || v === "lastActivity";
}

/** See teams.tsx SortChip — same a11y rationale. */
function SortChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      style={{
        padding: "4px 12px",
        borderRadius: 9999,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: active ? "var(--chakra-colors-orange-500)" : "var(--chakra-colors-border-muted)",
        backgroundColor: active ? "var(--chakra-colors-orange-50)" : "transparent",
        color: active ? "var(--chakra-colors-orange-700)" : "var(--chakra-colors-fg-muted)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

const fmtUsd = (n: number) =>
  n === 0 ? "$0.00" : numeral(n).format("$0,0.00");

const fmtRelative = (date: Date | string | null): string => {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
};

function fmtTrendPct(pct: number): string {
  const abs = Math.abs(pct);
  if (abs >= 1000) return ">1000%";
  if (abs < 1) return "0%";
  return `${Math.round(abs)}%`;
}

function GovernanceUsersListPage() {
  const router = useRouter();
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";

  const sortBy: SortField = isSortField(router.query.sort)
    ? router.query.sort
    : "spend";
  const setSortBy = (next: SortField) => {
    const params = new URLSearchParams();
    if (next !== "spend") params.set("sort", next);
    void router.replace(params.toString() ? `?${params.toString()}` : "?");
  };

  const usersQuery = api.activityMonitor.spendByUser.useQuery(
    {
      organizationId: orgId,
      windowDays: 30,
      limit: 500,
      sortBy,
      sortDir: "desc",
    },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const users = usersQuery.data ?? [];

  return (
    <GovernanceLayout pageTitle="Users · AI Governance · LangWatch">
      <VStack align="stretch" gap={4} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={1}>
            <Text fontSize="xs" color="fg.muted">
              <Link href="/settings/governance" color="blue.600">
                ← AI Governance
              </Link>{" "}
              · All users
            </Text>
            <Heading size="md">All users by {SORT_LABEL[sortBy]}</Heading>
            <Text color="fg.muted" fontSize="sm">
              Every LangWatch member that reported activity in the last
              30 days. Click a row to drill into a single user.
            </Text>
          </VStack>
        </HStack>

        <HStack gap={2}>
          <Text fontSize="sm" color="fg.muted" id="sort-by-label">
            Sort by:
          </Text>
          <SortChips
            value={sortBy}
            onChange={setSortBy}
            ariaLabelledBy="sort-by-label"
          />
        </HStack>

        <VStack
          align="stretch"
          gap={0}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          overflow="hidden"
        >
          <Header />
          {usersQuery.isLoading ? (
            <Box padding={6}>
              <Spinner />
            </Box>
          ) : users.length === 0 ? (
            <Box padding={6} color="fg.muted" fontSize="sm">
              No active users this window.
            </Box>
          ) : (
            users.map((u) => <Row key={u.actor} user={u} />)
          )}
        </VStack>
        <Text fontSize="xs" color="fg.muted">
          {users.length} user{users.length === 1 ? "" : "s"} shown.
        </Text>
      </VStack>
    </GovernanceLayout>
  );
}

function SortChips({
  value,
  onChange,
  ariaLabelledBy,
}: {
  value: SortField;
  onChange: (v: SortField) => void;
  ariaLabelledBy?: string;
}) {
  const opts: Array<{ key: SortField; label: string }> = [
    { key: "spend", label: "Spend" },
    { key: "requests", label: "Requests" },
    { key: "lastActivity", label: "Last active" },
  ];
  return (
    <HStack gap={1} role="radiogroup" aria-labelledby={ariaLabelledBy}>
      {opts.map((o) => (
        <SortChip
          key={o.key}
          label={o.label}
          active={o.key === value}
          onClick={() => onChange(o.key)}
        />
      ))}
    </HStack>
  );
}

function Header() {
  return (
    <HStack
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      fontSize="xs"
      fontWeight="semibold"
      color="fg.muted"
      textTransform="uppercase"
      letterSpacing="wider"
      backgroundColor="bg.subtle"
    >
      <Box flex={3}>User</Box>
      <Box flex={2}>Spend</Box>
      <Box flex={2}>Requests</Box>
      <Box flex={2}>Last active</Box>
      <Box flex={2}>Trend</Box>
      <Box flex={2}>Most-used</Box>
    </HStack>
  );
}

function Row({ user }: { user: SpendByUser }) {
  const dotColor = getHexColorForString(user.actor);
  const arrow =
    user.trendVsPreviousPct > 0
      ? "↑"
      : user.trendVsPreviousPct < 0
        ? "↓"
        : "·";
  const trendColor = !user.hasPriorBaseline
    ? "fg.muted"
    : user.trendVsPreviousPct > 25
      ? "orange.500"
      : user.trendVsPreviousPct < -25
        ? "blue.500"
        : "fg.muted";
  return (
    <Link
      href={`/settings/governance/users/${encodeURIComponent(user.actor)}`}
      display="block"
      width="full"
      _hover={{ textDecoration: "none" }}
    >
      <HStack
        paddingY={2}
        paddingX={3}
        borderBottomWidth="1px"
        borderColor="border.muted"
        fontSize="sm"
        _hover={{ backgroundColor: "bg.subtle" }}
        cursor="pointer"
      >
        <Box flex={3}>
          <HStack gap={2}>
            <Box
              width="10px"
              height="10px"
              borderRadius="full"
              backgroundColor={dotColor}
              flexShrink={0}
            />
            <Text fontWeight="medium">{user.actor}</Text>
          </HStack>
        </Box>
        <Box flex={2}>{fmtUsd(user.spendUsd)}</Box>
        <Box flex={2}>{numeral(user.requests).format("0,0")}</Box>
        <Box flex={2} color="fg.muted">
          {fmtRelative(user.lastActivityIso)}
        </Box>
        <Box flex={2} color={trendColor}>
          {user.hasPriorBaseline
            ? `${arrow} ${fmtTrendPct(user.trendVsPreviousPct)}`
            : "—"}
        </Box>
        <Box flex={2} color="fg.muted">
          {user.mostUsedTarget}
        </Box>
      </HStack>
    </Link>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("organization:manage", {
    bypassOnboardingRedirect: true,
  })(GovernanceUsersListPage),
);
