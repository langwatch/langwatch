import {
  Button,
  Card,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { Link } from "~/components/ui/link";
import { domainProofChipFor } from "~/features/sso/logic/domainProofChip";
import { api } from "~/utils/api";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import { IdentityChip } from "./IdentityRow";

/**
 * "How do I verify a domain?", answered where the question is asked.
 *
 * An administrator setting who may join reads the words "verified address on
 * your domain" and quite reasonably goes looking for where they prove the
 * domain. The answer lives on the Authentication page, under a heading about
 * identity providers, and nothing on this screen used to point at it.
 *
 * TWO MECHANISMS, AND THEY ARE NOT THE SAME ONE. This section says so out
 * loud, because collapsing them is the mistake this whole panel exists to
 * prevent:
 *
 *   - joining by domain is corroborated by YOUR MEMBERS — at least two of
 *     them holding a verified address on it. No DNS, no record, nothing for
 *     an administrator to publish;
 *   - single sign-on is proved by a DNS TXT RECORD an administrator publishes
 *     and we look up. That is the ceremony below.
 *
 * The ceremony itself stays on the Authentication page rather than being
 * built twice. This shows what state each domain is in and takes the reader
 * there — one place that issues records, one place that checks them.
 */
export function DomainVerificationSection({
  organizationId,
  canView,
}: {
  organizationId: string;
  /** Whether this reader may see single sign-on at all (D05, `sso:view`). */
  canView: boolean;
}) {
  const setup = api.ssoSetup.getSetup.useQuery(
    { organizationId },
    { enabled: canView && !!organizationId },
  );

  return (
    <Card.Root width="full" data-testid="domain-verification-section">
      <Card.Body>
        <VStack align="stretch" gap={4}>
          <VStack align="start" gap={1}>
            <Heading as="h3" size="sm">
              Your domains
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              A domain proved to us can route your people to your identity
              provider when they sign in.
            </Text>
          </VStack>

          {/* Said once, plainly, because the two are easy to confuse and the
              consequence of confusing them is an administrator publishing a
              DNS record to fix a joining setting it has nothing to do with. */}
          <Text color="fg.muted" fontSize="sm">
            Letting colleagues join by domain needs no DNS record. That works
            once at least two of your members have verified an address on the
            domain. Proving a domain for single sign-on is the DNS record below,
            and the two are independent.
          </Text>

          {!canView ? (
            <Text
              color="fg.muted"
              fontSize="sm"
              data-testid="domains-no-access"
            >
              You need permission to see single sign-on to read which domains
              have been proved. An administrator who has it can tell you.
            </Text>
          ) : setup.isError ? (
            <SectionErrorNotice
              error={setup.error}
              fallbackTitle="Couldn't read your domains"
            />
          ) : setup.isLoading ? (
            <Spinner size="sm" />
          ) : (
            <DomainStates setup={setup.data} />
          )}

          <HStack>
            <Link href="/settings/authentication">
              <Button size="sm" variant="outline">
                <ExternalLink size={14} />
                Prove a domain
              </Button>
            </Link>
          </HStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * What each domain's state is, in the words the ceremony uses.
 *
 * Five states rather than four, since the record is read again (ADR-123).
 * `WAVERING` and `LAPSED` are deliberately not the same chip: one is a
 * warning where nothing has changed and there is time, the other is the one
 * thing that actually stopped. Collapsing them would either alarm somebody
 * whose DNS is mid-migration or bury the change that matters.
 */
function DomainStates({
  setup,
}: {
  setup:
    | {
        connection: {
          verifiedDomains: string[];
          domainProofs: Array<{
            domain: string;
            proofState: "VERIFIED" | "WAVERING" | "LAPSED";
            graceEndsAtMs: number | null;
          }>;
        } | null;
        claims: Array<{
          domain: string;
          state: "WAITING" | "APPROVED" | "REJECTED";
          waitsForReview: boolean;
        }>;
      }
    | undefined;
}) {
  const verified = new Set(setup?.connection?.verifiedDomains ?? []);
  const proofByDomain = new Map(
    (setup?.connection?.domainProofs ?? []).map((proof) => [
      proof.domain,
      proof,
    ]),
  );
  const claims = setup?.claims ?? [];
  const claimed = new Set(claims.map((claim) => claim.domain));
  const provedOnly = [...verified].filter((domain) => !claimed.has(domain));

  if (claims.length === 0 && provedOnly.length === 0) {
    return (
      <Text color="fg.muted" fontSize="sm" data-testid="domains-empty">
        No domain has been claimed yet.
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={2} data-testid="domain-states">
      {[...claims.map((claim) => claim.domain), ...provedOnly].map((domain) => {
        const chip = domainProofChipFor({
          proved: verified.has(domain),
          proofState: proofByDomain.get(domain)?.proofState ?? "VERIFIED",
          graceEndsAtMs: proofByDomain.get(domain)?.graceEndsAtMs ?? null,
          claim: claims.find((candidate) => candidate.domain === domain),
        });
        return (
          <HStack key={domain} gap={3}>
            <Text fontSize="sm">{domain}</Text>
            <IdentityChip
              label={chip.label}
              tone={chip.tone}
              title={chip.title}
            />
          </HStack>
        );
      })}
    </VStack>
  );
}
