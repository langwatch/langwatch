import { formatInstant } from "@langwatch/design-system/describe-instant";
import { IdText } from "@langwatch/design-system/id-text";
import { Badge, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { OpsFeatureFlagTarget } from "@langwatch/ops-contract";
import type { ReactNode } from "react";

import { targetTitle } from "../../model/rule-targets.ts";

/**
 * A target with what tells it apart from others of the same name: an
 * organization's slug, plan, members, creation date and administrators; a
 * project's organization; a user's name and organizations.
 */
export function FeatureFlagTargetSummary({ target }: { target: OpsFeatureFlagTarget }) {
  return (
    <VStack align="stretch" gap={0.5} minWidth={0} textAlign="start">
      <HStack gap={2} wrap="wrap" minWidth={0}>
        <Text textStyle="sm" fontWeight="medium" truncate>
          {targetTitle(target)}
        </Text>
        {target.kind !== "user" && (
          <Text textStyle="xs" fontFamily="mono" color="fg.muted">
            {target.slug}
          </Text>
        )}
        {target.kind === "organization" && target.planName && (
          <Badge size="sm" variant="subtle">
            {target.planName}
          </Badge>
        )}
        <IdText value={target.id} label={`${target.kind} ID`} copyable={false} />
      </HStack>
      <TargetFacts target={target} />
    </VStack>
  );
}

function TargetFacts({ target }: { target: OpsFeatureFlagTarget }) {
  if (target.kind === "organization") {
    return (
      <Facts>
        {target.memberCount === 1 ? "1 member" : `${target.memberCount} members`}
        {`Created ${formatInstant({ epochMs: target.createdAtMs, display: "date" })}`}
        {target.administratorEmails.length > 0
          ? `Admin ${target.administratorEmails.join(", ")}`
          : "No admin who can sign in"}
      </Facts>
    );
  }
  if (target.kind === "project") {
    return (
      <Facts>
        {target.organization
          ? `In ${target.organization.name} (${target.organization.slug})`
          : "Organization not found"}
      </Facts>
    );
  }
  return (
    <Facts>
      {target.email && target.name ? target.name : null}
      {target.organizations.length > 0
        ? target.organizations.map(({ name, slug }) => `${name} (${slug})`).join(", ")
        : "No organization"}
    </Facts>
  );
}

function Facts({ children }: { children: ReactNode[] | ReactNode }) {
  const facts = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <HStack gap={1.5} wrap="wrap" textStyle="xs" color="fg.muted">
      {facts.map((fact, index) => (
        <Text as="span" key={index}>
          {index > 0 && "· "}
          {fact}
        </Text>
      ))}
    </HStack>
  );
}
