import { Badge, Text } from "@chakra-ui/react";
import type { OrganizationMemberProvenance } from "@langwatch/organization-contract";

/**
 * Why a member is here, in one word; a member nobody can explain gets no chip
 * rather than an invented reason (specs/identity/directory-administration.feature).
 */
export function ProvenanceChip({
  provenance,
}: {
  provenance: OrganizationMemberProvenance | undefined;
}) {
  if (!provenance || provenance.source === "unknown") return null;
  if (provenance.source === "directory") {
    return (
      <Badge
        colorPalette="gray"
        size="sm"
        data-testid="provenance-directory"
        title={
          provenance.providerId
            ? `Created by ${provenance.providerId}. Your identity provider decides whether this person stays.`
            : "Created by your identity provider, which decides whether this person stays."
        }
      >
        Directory
      </Badge>
    );
  }
  if (provenance.source === "domain") {
    return (
      <Badge
        colorPalette={provenance.automatic ? "orange" : "gray"}
        size="sm"
        data-testid="provenance-domain"
        title={
          provenance.automatic
            ? `Joined on ${provenance.domain} under your joining policy. Nobody approved this.`
            : `Asked to join on ${provenance.domain}, and an administrator approved it.`
        }
      >
        Domain
      </Badge>
    );
  }
  return (
    <Badge
      colorPalette="gray"
      size="sm"
      data-testid="provenance-invited"
      title="Somebody here invited them, and they accepted."
    >
      Invited
    </Badge>
  );
}

/** The sentence behind the chip, for somebody who opened the member to ask. */
export function ProvenanceExplanation({
  provenance,
}: {
  provenance: OrganizationMemberProvenance | undefined;
}) {
  return (
    <Text fontSize="sm" color="fg.muted" data-testid="provenance-explanation">
      {provenanceSentence(provenance)}
    </Text>
  );
}

function provenanceSentence(provenance: OrganizationMemberProvenance | undefined): string {
  if (!provenance || provenance.source === "unknown") {
    return "Nothing on record says how they got here. That is what an organization founder looks like, and anybody who joined before we started keeping this.";
  }
  if (provenance.source === "directory") {
    const creator = provenance.providerId
      ? `${provenance.providerId} created them.`
      : "Your identity provider created them.";
    return `${creator} It decides whether they stay, and removing them here does not stop it putting them back.`;
  }
  if (provenance.source === "domain") {
    return provenance.automatic
      ? `They joined on ${provenance.domain} under your joining policy, without anybody approving.`
      : `They asked to join on ${provenance.domain}, and an administrator approved it.`;
  }
  return "Somebody here invited them, and they accepted.";
}
