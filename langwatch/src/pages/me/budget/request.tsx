import {
  Alert,
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Mail, TrendingUp, CheckCircle2, AlertTriangle } from "lucide-react";
import { useState } from "react";
import Head from "~/utils/compat/next-head";
import { useRouter } from "~/utils/compat/next-router";

import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";
import MyLayout from "~/components/me/MyLayout";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";

const fmtUsd = (n: number) => formatBudgetUsd(n);

const queryParam = (raw: unknown): string => {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return "";
};

const parseUsd = (raw: string): number | null => {
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
};

function RequestBudgetIncreasePage() {
  const router = useRouter();
  const { data: session } = useRequiredSession();
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const scope = queryParam(router.query.scope);
  const scopeId = queryParam(router.query.scope_id);
  const limitUsdRaw = queryParam(router.query.limit_usd);
  const spentUsdRaw = queryParam(router.query.spent_usd);
  const periodRaw = queryParam(router.query.period);
  const limitUsd = parseUsd(limitUsdRaw);
  const spentUsd = parseUsd(spentUsdRaw);
  const period = periodRaw || "current period";
  const hasContext = !!(scope && scopeId && limitUsd !== null && spentUsd !== null);

  const adminQuery = api.user.personalBudget.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization, refetchOnWindowFocus: false },
  );
  const adminEmail =
    adminQuery.data && "adminEmail" in adminQuery.data
      ? adminQuery.data.adminEmail ?? null
      : null;

  const [message, setMessage] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "sent">(
    "idle",
  );

  const requestMutation = api.user.requestBudgetIncrease.useMutation({
    onSuccess: () => {
      setSubmitState("sent");
    },
    onError: (err) => {
      setSubmitState("idle");
      toaster.create({
        title:
          err.message === "no_admin_found"
            ? "No organization admin is configured"
            : "Could not send request",
        description:
          err.message === "no_admin_found"
            ? "Contact LangWatch support to configure an admin."
            : adminEmail
              ? `Try again, or email ${adminEmail} directly.`
              : "Try again or contact your organization admin directly.",
        type: "error",
        duration: 7000,
      });
    },
  });


  const noOrg = !!session && !organization;

  const submit = () => {
    if (!organization) return;
    setSubmitState("submitting");
    requestMutation.mutate({
      organizationId: organization.id,
      scope,
      scopeId,
      limitUsd: limitUsdRaw,
      spentUsd: spentUsdRaw,
      period: periodRaw || undefined,
      message: message.trim() ? message.trim() : undefined,
    });
  };

  return (
    <MyLayout>
      <Head>
        <title>Request budget increase · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full" maxWidth="640px">
        <HStack alignItems="end">
          <VStack align="start" gap={0}>
            <Heading as="h2" size="lg">
              Request budget increase
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Send the request to your organization admin with the current
              spend and limit context.
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        {noOrg && (
          <Alert.Root status="info" borderRadius="md">
            <Alert.Indicator />
            <Box>
              <Alert.Title>Personal account — no admin to email</Alert.Title>
              <Alert.Description fontSize="sm">
                Budget-increase requests only apply to organization-managed
                accounts. Personal accounts manage their own limits in
                Settings.
              </Alert.Description>
            </Box>
          </Alert.Root>
        )}

        {!noOrg && submitState === "sent" && (
          <Alert.Root status="success" borderRadius="md">
            <Alert.Indicator>
              <CheckCircle2 size={18} />
            </Alert.Indicator>
            <Box>
              <Alert.Title>Request sent</Alert.Title>
              <Alert.Description fontSize="sm">
                We emailed {adminEmail ?? "your organization admin"} with the
                spend context. They'll review and update the budget in
                Settings → AI Governance → Budgets.
              </Alert.Description>
            </Box>
          </Alert.Root>
        )}

        {!noOrg && submitState !== "sent" && (
          <>
            {hasContext ? (
              <Box
                borderWidth="1px"
                borderColor="border.muted"
                borderRadius="md"
                padding={4}
                backgroundColor="bg.subtle"
              >
                <Text
                  fontSize="xs"
                  color="fg.muted"
                  textTransform="uppercase"
                  letterSpacing="wider"
                  marginBottom={3}
                >
                  Context (carried from the gateway block)
                </Text>
                <VStack align="stretch" gap={2}>
                  <ContextRow label="Scope" value={scope} />
                  <ContextRow label="Period" value={period} />
                  <ContextRow
                    label="Spent so far"
                    value={fmtUsd(spentUsd ?? 0)}
                    tone="red"
                  />
                  <ContextRow
                    label="Current limit"
                    value={fmtUsd(limitUsd ?? 0)}
                  />
                </VStack>
              </Box>
            ) : (
              <Alert.Root status="warning" borderRadius="md">
                <Alert.Indicator>
                  <AlertTriangle size={18} />
                </Alert.Indicator>
                <Box>
                  <Alert.Title>No context attached</Alert.Title>
                  <Alert.Description fontSize="sm">
                    The page was opened without a budget block context.
                    You can still send a free-form message — the admin will
                    review and decide.
                  </Alert.Description>
                </Box>
              </Alert.Root>
            )}

            <Box
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="md"
              padding={4}
            >
              <HStack marginBottom={2} fontSize="sm" color="fg.muted">
                <Mail size={14} />
                <Text>
                  To: <strong>{adminEmail ?? "your organization admin"}</strong>
                </Text>
              </HStack>
              <Text fontSize="xs" color="fg.muted" marginBottom={3}>
                Optional message — explain why you need the increase
              </Text>
              <Textarea
                placeholder="e.g. Need it for the demo on Friday — usually under limit"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                minHeight="100px"
                resize="vertical"
              />
            </Box>

            <HStack>
              <Spacer />
              <Button
                colorPalette="orange"
                onClick={submit}
                disabled={
                  submitState === "submitting" ||
                  !organization ||
                  adminQuery.isLoading
                }
                loading={submitState === "submitting"}
              >
                <TrendingUp size={16} />
                Send request
              </Button>
            </HStack>
          </>
        )}
      </VStack>
    </MyLayout>
  );
}

function ContextRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "red";
}) {
  return (
    <HStack fontSize="sm">
      <Text color="fg.muted" minWidth="120px">
        {label}
      </Text>
      <Text
        fontFamily="mono"
        color={tone === "red" ? "red.500" : "fg"}
        fontWeight={tone === "red" ? "semibold" : "normal"}
      >
        {value}
      </Text>
    </HStack>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(RequestBudgetIncreasePage);
