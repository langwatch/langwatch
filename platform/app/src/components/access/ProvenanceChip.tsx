import type { RouterOutputs } from "~/utils/api";
import { IdentityChip } from "./IdentityRow";

export type MemberProvenance =
  RouterOutputs["organization"]["getMemberProvenance"][string];

/**
 * Why this person is in the organization, in one word.
 *
 * The question an administrator asks of a member they did not recognise, and
 * the three answers lead to three different conversations: an invitation is
 * somebody here vouching for them, a domain is a policy this organization
 * set, and a directory is the identity provider's decision that this
 * organization does not own.
 *
 * A member we cannot explain gets NO chip rather than a fourth word. The
 * person who created the organization is the ordinary case, and giving them
 * an invented provenance would make the other three less believable — which
 * is the whole value of the chip.
 */
export function ProvenanceChip({
  provenance,
}: {
  provenance: MemberProvenance | undefined;
}) {
  if (!provenance || provenance.source === "unknown") return null;

  if (provenance.source === "directory") {
    return (
      <IdentityChip
        label="Directory"
        title={
          provenance.providerId
            ? `Created by ${provenance.providerId}. Your identity provider decides whether this person stays.`
            : "Created by your identity provider, which decides whether this person stays."
        }
        data-testid="provenance-directory"
      />
    );
  }

  if (provenance.source === "domain") {
    return (
      <IdentityChip
        label="Domain"
        tone={provenance.automatic ? "warning" : "neutral"}
        title={
          provenance.automatic
            ? `Joined on ${provenance.domain} under your joining policy. Nobody approved this.`
            : `Asked to join on ${provenance.domain}, and an administrator approved it.`
        }
        data-testid="provenance-domain"
      />
    );
  }

  return (
    <IdentityChip
      label="Invited"
      title="Somebody here invited them, and they accepted."
      data-testid="provenance-invited"
    />
  );
}
