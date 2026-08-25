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
import { api } from "~/utils/api";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import { IdentityChip } from "./IdentityRow";

/**
 * "How do I verify a domain?", answered where the question is asked.
 *
 * An administrator setting who may join reads the words "verified address on
 * your domain" and quite reasonably goes looking for where they prove the
 * domain. Until now the answer lived only on the Single Sign-On page, under a
 * heading about identity providers, and nothing on this screen pointed at it.
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
 * The ceremony itself stays on the Single Sign-On page rather than being
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
            <Link href="/settings/single-sign-on">
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
        const chip = chipFor({
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

/** The one thing a reader has to publish, and nothing about who is busy. */
const PUBLISH_IT = "Publish the DNS record and ask us to check for it.";

/**
 * Which chip one domain gets, as a table rather than a ternary staircase.
 *
 * Ordered by what a reader most needs to know: whether the evidence behind a
 * proved domain has gone, then whether it is proved at all, then where an
 * unproved claim stands. A lapsed domain is read before a proved one on
 * purpose — it is still in `verifiedDomains`, because it still routes, and a
 * chip that said "Proved" would be technically true and completely wrong.
 */
function chipFor({
  proved,
  proofState,
  graceEndsAtMs,
  claim,
}: {
  proved: boolean;
  proofState: "VERIFIED" | "WAVERING" | "LAPSED";
  graceEndsAtMs: number | null;
  claim:
    | { state: "WAITING" | "APPROVED" | "REJECTED"; waitsForReview: boolean }
    | undefined;
}): { label: string; tone: "good" | "warning" | "bad"; title: string } {
  if (proved && proofState === "LAPSED") {
    return {
      label: "Record missing",
      tone: "bad",
      title:
        "We haven't been able to find your record for two days, so this domain no longer lets new people in on its own. Everyone already here signs in as usual — publish the record again and it goes back to normal.",
    };
  }
  if (proved && proofState === "WAVERING") {
    return {
      label: "Record not found",
      tone: "warning",
      title: graceEndsAtMs
        ? `We can't find your record right now. Nothing has changed yet — republish it before ${new Date(graceEndsAtMs).toLocaleString()} and nothing will.`
        : "We can't find your record right now. Nothing has changed yet — republish it and nothing will.",
    };
  }
  if (proved) {
    return {
      label: "Proved",
      tone: "good",
      title:
        "We found the record. This domain routes sign-ins to your identity provider.",
    };
  }
  // The only claim a person is looking at is one on a domain somebody else
  // already proved. Every other waiting claim is waiting for the READER.
  if (claim?.state === "WAITING" && claim.waitsForReview) {
    return {
      label: "Waiting for review",
      tone: "warning",
      title: "We are checking this claim by hand.",
    };
  }
  if (claim?.state === "REJECTED") {
    return {
      label: "Not approved",
      tone: "bad",
      title: "This claim was not approved. You can claim it again.",
    };
  }
  return { label: "Not proved yet", tone: "warning", title: PUBLISH_IT };
}
