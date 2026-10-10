import { DetailDrawerHeader } from "@langwatch/design-system/detail-drawer-header";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { Badge, Box, Heading, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ResourceRow } from "@langwatch/design-system/resource-row";
import { SummaryList, SummaryListItem } from "@langwatch/design-system/summary-list";
import type { AdminSsoConnection } from "@langwatch/enterprise-sso-contract";
import { Building2, Check, Globe, ShieldCheck, Users } from "lucide-react";

import { useAdminOne } from "../../behavior/use-admin-resource.ts";
import type { AdminUser } from "./users-view.tsx";

export const STATE_TONE: Record<string, string> = {
  ACTIVE: "green",
  SUSPENDED: "orange",
  TEARDOWN_PENDING: "orange",
  TORN_DOWN: "red",
  REJECTED: "red",
  DISCARDED: "gray",
};

export const METHOD_LABEL: Record<string, string> = {
  "dns-txt": "Published record",
  "https-file": "Published file",
  "license-token": "License",
  "operator-attested": "Attested by LangWatch",
  "legacy-configuration": "Earlier configuration",
};

const JOIN_POLICY = {
  admit: "Join automatically",
  request: "Administrator approval",
  refuse: "Existing members only",
} as const;

export function ConnectionHeader({ connection }: { connection: AdminSsoConnection }) {
  const state = connection.state.replaceAll("_", " ").toLowerCase();

  return (
    <DetailDrawerHeader
      icon={<ShieldCheck size={14} aria-hidden />}
      kind="SSO connection"
      title={connection.providerId}
    >
      <HStack gap={1.5} color="fg.muted" fontSize="sm" minWidth={0}>
        <Building2 size={14} aria-hidden />
        <Text overflowWrap="anywhere">
          {connection.organizationName ?? "Organization unavailable"}
        </Text>
      </HStack>
      <Badge variant="outline" colorPalette="gray">
        {connection.type.toUpperCase()}
      </Badge>
      <Badge colorPalette={STATE_TONE[connection.state] ?? "gray"}>
        <Box boxSize="1.5" borderRadius="full" bg="colorPalette.solid" aria-hidden />
        {state.charAt(0).toUpperCase() + state.slice(1)}
      </Badge>
    </DetailDrawerHeader>
  );
}

export function ConnectionSummary({ connection }: { connection: AdminSsoConnection }) {
  return (
    <Box as="section" aria-label="Summary">
      <Heading as="h3" size="sm" marginBottom={3}>
        Summary
      </Heading>
      <SummaryList>
        <SummaryListItem label="Identity provider">{connection.providerId}</SummaryListItem>
        <SummaryListItem label="Issuer">{connection.issuer}</SummaryListItem>
        <SummaryListItem label="Set up via">
          {connection.source === "legacy-grandfathered"
            ? "Earlier configuration"
            : "Single sign-on setup"}
        </SummaryListItem>
        <SummaryListItem label="Join policy">
          <Badge colorPalette="gray" variant="subtle" whiteSpace="normal">
            <Users size={12} aria-hidden />
            {JOIN_POLICY[connection.arrivalPolicy]}
          </Badge>
        </SummaryListItem>
      </SummaryList>
    </Box>
  );
}

function VerificationActor({ actorId }: { actorId: string | null }) {
  const person = useAdminOne<AdminUser>("user", actorId, { retry: false });
  const user = person.data?.data;

  if (!actorId) return <Text as="span">Verifier not recorded</Text>;
  if (person.isLoading) return <Text as="span">Loading verifier…</Text>;
  if (!user || person.error) return <Text as="span">Verifier unavailable</Text>;

  return (
    <Text as="span" title={user.email ?? void 0}>
      Verified by{" "}
      <Text as="span" color="fg">
        {user.name || user.email || "Unnamed person"}
      </Text>
      {user.name && user.email && <Text as="span"> · {user.email}</Text>}
    </Text>
  );
}

export function ConnectionDomains({ connection }: { connection: AdminSsoConnection }) {
  return (
    <Box
      as="section"
      aria-label="Domains"
      borderTopWidth="1px"
      borderColor="border.muted"
      paddingTop={5}
    >
      <Heading as="h3" size="sm" marginBottom={3}>
        Domains
      </Heading>
      <VStack align="stretch" gap={2}>
        {connection.domainVerifications.map((entry) => (
          <ResourceRow
            key={entry.domain}
            icon={<Globe size={16} />}
            name={entry.domain}
            status={
              <Badge colorPalette="green">
                <Check size={12} aria-hidden />
                Verified
              </Badge>
            }
            description={METHOD_LABEL[entry.method] ?? entry.method}
            meta={
              <>
                <VerificationActor actorId={entry.actorId} />
                <Text as="span"> · </Text>
                <FormattedDate value={entry.verifiedAtMs} display="relative" />
              </>
            }
          />
        ))}
        {connection.domainVerifications.length === 0 && (
          <Text color="fg.muted" fontSize="sm">
            No domain has been proved yet.
          </Text>
        )}
        {connection.claimedDomains.map((domain) => (
          <PendingDomain key={domain} domain={domain} status="Awaiting approval" />
        ))}
        {connection.approvedDomains.map((domain) => (
          <PendingDomain key={domain} domain={domain} status="Awaiting verification" />
        ))}
      </VStack>
      {connection.rejection && (
        <Text fontSize="sm" color="fg.muted" marginTop={2}>
          {connection.rejection.domain} was turned down: {connection.rejection.note}
        </Text>
      )}
    </Box>
  );
}

function PendingDomain({ domain, status }: { domain: string; status: string }) {
  return (
    <HStack
      justify="space-between"
      gap={2}
      flexWrap="wrap"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      padding={3}
    >
      <Text fontSize="sm" overflowWrap="anywhere">
        {domain}
      </Text>
      <Badge colorPalette="orange">{status}</Badge>
    </HStack>
  );
}
