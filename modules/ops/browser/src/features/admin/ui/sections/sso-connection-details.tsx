import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Box, Heading, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ResourceRow } from "@langwatch/design-system/resource-row";
import { SummaryList, SummaryListItem } from "@langwatch/design-system/summary-list";
import type { AdminSsoConnection } from "@langwatch/enterprise-sso-contract";
import { Building2, Check, Globe, Users } from "lucide-react";

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

/** The context chips under the drawer title: organization, protocol and state. */
export function ConnectionHeaderBadges({ connection }: { connection: AdminSsoConnection }) {
  const state = connection.state.replaceAll("_", " ").toLowerCase();

  return (
    <>
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
    </>
  );
}

export function ConnectionSummary({ connection }: { connection: AdminSsoConnection }) {
  return (
    <Box as="section" aria-label="Summary">
      <Heading as="h3" textStyle="cardTitle" marginBottom={3}>
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
      <Heading as="h3" textStyle="cardTitle" marginBottom={3}>
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
          <NoDataInfoBlock size="line" title={noDomainProvedTitle(connection)} />
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

/** What an operator can do next, from the claims and approvals the connection already holds. */
function noDomainProvedTitle(
  connection: Pick<AdminSsoConnection, "claimedDomains" | "approvedDomains">,
): string {
  const steps: string[] = [];
  if (connection.claimedDomains.length > 0) {
    steps.push("Review the pending domain claims below before approving them.");
  }
  if (connection.approvedDomains.length > 0) {
    steps.push(
      "Ask the organization administrator to complete verification for the approved domains.",
    );
  }
  if (steps.length === 0) {
    steps.push(
      "Ask the organization administrator to add and verify a domain in single sign-on setup.",
    );
  }
  return `No domain has been proved yet. ${steps.join(" ")}`;
}
