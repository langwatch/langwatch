import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  KeyRound,
  Laptop,
  Monitor,
  Server,
} from "lucide-react";
import { useState } from "react";
import Head from "~/utils/compat/next-head";

import MyLayout from "~/components/me/MyLayout";
import {
  type PersonalApiKeyRow,
  usePersonalContext,
} from "~/components/me/usePersonalContext";

const fmtRelative = (iso: string | null): string => {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
};

const fmtUsd = (amount: number): string =>
  amount === 0
    ? "$0.00"
    : `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MySettingsPage() {
  const ctx = usePersonalContext();
  const [prefs, setPrefs] = useState(ctx.notificationPrefs);

  return (
    <>
      <Head>
        <title>My Settings · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full">
        <HStack alignItems="end">
          <VStack align="start" gap={0}>
            <Heading as="h2" size="lg">
              Settings
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Manage your personal API keys, notifications, and view your
              admin-managed budget
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        <SectionCard title="Profile">
          <VStack align="stretch" gap={3}>
            <Field label="Name" value={ctx.fullName} />
            <Field
              label="Email"
              value={ctx.email}
              hint={`Managed by ${ctx.organizationName} IT`}
            />
            <Field label="Joined" value={ctx.joinedOn} />
            {ctx.routingPolicyName && (
              <Field
                label="Routing"
                value={
                  <HStack gap={2}>
                    <Text>{ctx.routingPolicyName}</Text>
                    <Badge variant="surface" colorPalette="gray" size="sm">
                      managed by your org
                    </Badge>
                  </HStack>
                }
              />
            )}
          </VStack>
        </SectionCard>

        <SectionCard
          title="Personal API Keys"
          description="These keys let your CLI tools (Claude Code, Cursor, etc.) talk to LangWatch."
          action={
            <Button size="sm" variant="outline" disabled title="Coming next iteration">
              + Add a new key
            </Button>
          }
        >
          {ctx.apiKeys.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              No personal keys yet. Run <code>langwatch login</code> in your
              terminal to issue your first one.
            </Text>
          ) : (
            <VStack align="stretch" gap={2}>
              {ctx.apiKeys.map((key) => (
                <ApiKeyRow key={key.id} apiKey={key} />
              ))}
            </VStack>
          )}
        </SectionCard>

        <SectionCard title="Notifications">
          <VStack align="stretch" gap={2}>
            <CheckboxRow
              label="Alert me when I hit 80% of my monthly budget"
              checked={prefs.budgetThreshold80}
              onChange={(v) =>
                setPrefs({ ...prefs, budgetThreshold80: v })
              }
            />
            <CheckboxRow
              label="Weekly usage summary"
              checked={prefs.weeklySummary}
              onChange={(v) => setPrefs({ ...prefs, weeklySummary: v })}
            />
            <CheckboxRow
              label="Each request over $1.00"
              checked={prefs.perRequestOverOneDollar}
              onChange={(v) =>
                setPrefs({ ...prefs, perRequestOverOneDollar: v })
              }
            />
          </VStack>
        </SectionCard>

        <SectionCard title="Budget">
          {ctx.summary.budgetUsd === null ? (
            <VStack align="start" gap={1}>
              <Text fontSize="sm" color="fg.muted">
                No personal budget set by your admin.
              </Text>
              <Text fontSize="xs" color="fg.muted">
                If you'd like one, ask your admin.
              </Text>
            </VStack>
          ) : (
            <VStack align="stretch" gap={3}>
              <Field
                label="Monthly limit"
                value={fmtUsd(ctx.summary.budgetUsd)}
                hint={`Set by your ${ctx.organizationName} admin · cannot edit`}
              />
              <Field
                label="Current spend"
                value={fmtUsd(ctx.summary.spentThisMonthUsd)}
              />
            </VStack>
          )}
        </SectionCard>
      </VStack>
    </>
  );
}

MySettingsPage.layout = MyLayout;

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
    >
      <HStack alignItems="start" marginBottom={3}>
        <VStack align="start" gap={0}>
          <Text fontSize="sm" fontWeight="semibold">
            {title}
          </Text>
          {description && (
            <Text fontSize="xs" color="fg.muted">
              {description}
            </Text>
          )}
        </VStack>
        <Spacer />
        {action}
      </HStack>
      {children}
    </Box>
  );
}

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <HStack alignItems="start" gap={4}>
      <Text fontSize="sm" color="fg.muted" minWidth="100px" paddingTop={1}>
        {label}
      </Text>
      <VStack align="start" gap={0}>
        {typeof value === "string" ? (
          <Text fontSize="sm">{value}</Text>
        ) : (
          value
        )}
        {hint && (
          <Text fontSize="xs" color="fg.muted">
            {hint}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

function ApiKeyRow({ apiKey }: { apiKey: PersonalApiKeyRow }) {
  const Icon =
    apiKey.os === "macOS" || apiKey.os === "Windows"
      ? Laptop
      : apiKey.os === "Linux"
        ? Monitor
        : Server;

  return (
    <HStack
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="sm"
      padding={3}
      gap={3}
    >
      <Box>
        <Icon size={20} />
      </Box>
      <VStack align="start" gap={0} flex={1}>
        <Text fontSize="sm" fontWeight="medium">
          {apiKey.label}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {apiKey.deviceHint} · Last used {fmtRelative(apiKey.lastUsedAt)}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Created {apiKey.createdAt}
        </Text>
      </VStack>
      <Button
        size="sm"
        variant="outline"
        colorPalette="red"
        disabled
        title="Coming next iteration"
      >
        Revoke
      </Button>
    </HStack>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <HStack
      paddingY={1}
      cursor="pointer"
      onClick={() => onChange(!checked)}
      gap={3}
    >
      <Box
        width="16px"
        height="16px"
        borderRadius="sm"
        borderWidth="1px"
        borderColor={checked ? "blue.500" : "border.emphasis"}
        backgroundColor={checked ? "blue.500" : "transparent"}
        display="flex"
        alignItems="center"
        justifyContent="center"
        color="white"
        fontSize="10px"
      >
        {checked && "✓"}
      </Box>
      <Text fontSize="sm">{label}</Text>
    </HStack>
  );
}
