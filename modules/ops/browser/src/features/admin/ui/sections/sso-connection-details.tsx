import { Drawer } from "@langwatch/design-system/drawer";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import {
  Badge,
  Box,
  Grid,
  Heading,
  HStack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type { AdminSsoConnection } from "@langwatch/enterprise-sso-contract";
import { Building2, Check, Globe, ShieldCheck, Users } from "lucide-react";
import type { ReactNode } from "react";

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
    <VStack align="stretch" gap={3}>
      <HStack color="fg.muted" gap={2} fontSize="xs">
        <ShieldCheck size={14} aria-hidden />
        <Text>SSO connection</Text>
      </HStack>
      <Drawer.Title overflowWrap="anywhere">{connection.providerId}</Drawer.Title>
      <HStack gap={2} flexWrap="wrap">
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
      </HStack>
    </VStack>
  );
}

export function ConnectionSummary({ connection }: { connection: AdminSsoConnection }) {
  return (
    <Box as="section" aria-label="Summary">
      <Heading as="h3" size="sm" marginBottom={3}>
        Summary
      </Heading>
      <Grid
        as="dl"
        templateColumns={{ base: "1fr", sm: "112px minmax(0, 1fr)" }}
        columnGap={4}
        rowGap={3}
        fontSize="sm"
      >
        <SummaryField label="Identity provider">{connection.providerId}</SummaryField>
        <SummaryField label="Issuer">{connection.issuer || "—"}</SummaryField>
        <SummaryField label="Set up via">
          {connection.source === "legacy-grandfathered"
            ? "Earlier configuration"
            : "Single sign-on setup"}
        </SummaryField>
        <SummaryField label="Join policy">
          <Badge colorPalette="gray" variant="subtle" whiteSpace="normal">
            <Users size={12} aria-hidden />
            {JOIN_POLICY[connection.arrivalPolicy]}
          </Badge>
        </SummaryField>
      </Grid>
    </Box>
  );
}

function SummaryField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Text as="dt" color="fg.muted">
        {label}
      </Text>
      <Box as="dd" minWidth={0} overflowWrap="anywhere">
        {children}
      </Box>
    </>
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
          <Box
            key={entry.domain}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="lg"
            padding={3.5}
          >
            <HStack justify="space-between" gap={2} align="start" flexWrap="wrap">
              <HStack gap={2} minWidth={0}>
                <Box color="fg.muted" flexShrink={0}>
                  <Globe size={16} aria-hidden />
                </Box>
                <Text fontSize="sm" fontWeight="medium" overflowWrap="anywhere">
                  {entry.domain}
                </Text>
              </HStack>
              <Badge colorPalette="green">
                <Check size={12} aria-hidden />
                Verified
              </Badge>
            </HStack>
            <Text fontSize="xs" color="fg.muted" marginTop={2}>
              {METHOD_LABEL[entry.method] ?? entry.method}
            </Text>
            <Box fontSize="xs" color="fg.muted" marginTop={1} overflowWrap="anywhere">
              <VerificationActor actorId={entry.actorId} />
              <Text as="span"> · </Text>
              <FormattedDate value={entry.verifiedAtMs} display="relative" />
            </Box>
          </Box>
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
