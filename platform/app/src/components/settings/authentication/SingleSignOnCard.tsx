import { Button, HStack, Text } from "@chakra-ui/react";
import type { SelfServeSetupView } from "@langwatch/identity-server";
import { ExternalLink, RefreshCw } from "lucide-react";
import { IdentityChip } from "~/components/access/IdentityRow";
import { Link } from "~/components/ui/link";
import { TestSignInFailureNotice } from "~/features/sso/components/TestSignInFailureNotice";
import { useTestSignIn } from "~/features/sso/hooks/useTestSignIn";
import {
  connectionProtocolName,
  connectionStatusChipFor,
} from "~/features/sso/logic/connectionStatus";
import { domainProofChipFor } from "~/features/sso/logic/domainProofChip";
import { identityProviderPreset } from "../singleSignOn/identityProviders";
import { OverviewCard, OverviewDetail } from "./OverviewCard";

/**
 * The protocol's own mark, from the catalogue the setup journey picks from —
 * so the card wears the tile somebody chose rather than a second icon set
 * invented here. Nothing is drawn where the catalogue has no mark: initials
 * standing in for a logo read as a logo nobody recognises.
 */
function ProtocolMark({ type }: { type: string }) {
  const Icon = identityProviderPreset(type).icon;
  return Icon ? <Icon size={14} aria-hidden /> : null;
}

/**
 * The answer to a "can anybody" question, in words rather than as a bare
 * number. "0" beside "Can anybody get back in without it?" is a number the
 * reader has to turn back into the answer they asked for.
 */
function peopleCount(count: number): string {
  if (count === 0) return "Nobody";
  return count === 1 ? "1 person" : `${count} people`;
}

/** Spelled out, never abbreviated: "24 Aug 2026", not "24/08". */
function formatDay(atMs: number): string {
  return new Date(atMs).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A setup read whose connection is known to exist. */
type LiveSetup = SelfServeSetupView & {
  connection: NonNullable<SelfServeSetupView["connection"]>;
};

/**
 * How everyone signs in, on a live connection (ADR-124, wave 3).
 *
 * NAMED BY ITS PROTOCOL, because that is what the administrator configured at
 * the other end and how they recognize their own connection. The chip beside
 * it says where the connection stands in words rather than in the aggregate's
 * vocabulary, and it separates a connection that is on from one that is
 * actually carrying sign-ins.
 *
 * THE DOMAIN CHIPS ARE THE SETUP JOURNEY'S. A domain whose published record
 * has vanished is still in `verifiedDomains`, because it still routes the
 * people already here, and an overview that listed it as a plain proved
 * domain would tell somebody their sign-in is fine while the evidence behind
 * it has gone. Same table, same words, both screens.
 *
 * WHAT IS NOT HERE. The signing certificate's expiry: the certificate is kept
 * as the administrator handed it to us and nothing reads a date out of it, so
 * a row for one would be an invented fact. Metadata is offered for SAML only,
 * where a document is actually published.
 *
 * Spec: specs/identity/sso-activation.feature
 */
export function SingleSignOnCard({
  setup,
  canManage,
}: {
  setup: LiveSetup;
  canManage: boolean;
}) {
  const { connection, claims, goLive, serviceProvider } = setup;
  const { start, sending, failure } = useTestSignIn({
    connectionId: connection.connectionId,
  });

  const proofByDomain = new Map(
    connection.domainProofs.map((proof) => [proof.domain, proof]),
  );

  return (
    <OverviewCard
      title={connectionProtocolName(connection.type)}
      // The PROTOCOL'S mark, taken from the same catalogue the setup journey
      // picks from, so the card wears the tile somebody chose. The title here
      // is a sentence rather than a name, and a sentence is slower to
      // recognise than a mark.
      leading={<ProtocolMark type={connection.type} />}
      chip={connectionStatusChipFor({
        state: connection.state,
        routingSwitchedOn: goLive?.routingSwitchedOn ?? false,
      })}
      data-testid="single-sign-on-card"
      actions={
        <>
          {canManage && (
            <Button
              size="sm"
              variant={failure ? "solid" : "outline"}
              loading={sending}
              onClick={() => void start()}
            >
              {/* It hands the browser to the identity provider and back, so
                  it is marked as leaving rather than as acting here. */}
              {failure ? <RefreshCw size={14} /> : <ExternalLink size={14} />}
              {failure ? "Try the sign-in again" : "Test sign-in"}
            </Button>
          )}
          {/* Only SAML has a published document to point at. */}
          {connection.type === "saml" && (
            <Link href={serviceProvider.metadataUrl} isExternal>
              <Button size="sm" variant="ghost">
                <ExternalLink size={14} />
                Service provider metadata
              </Button>
            </Link>
          )}
        </>
      }
    >
      {/* Above the details rather than below them: a test sign-in that just
          failed is the newest thing the reader knows about this connection,
          and it belongs where they are already looking — on the card naming
          the provider that refused, not in a corner for eight seconds. */}
      {failure && <TestSignInFailureNotice failure={failure} />}

      {/* THE ROWS ARE THE QUESTIONS SOMEBODY CAME WITH, not the fields the
          record happens to have. "Identity provider — okta" is a label and a
          value, and a reader has to do the work of turning it into the
          question they were actually asking; "Who signs people in? okta"
          already is that question, and the card reads as a page answering
          them rather than as a dump of the connection row.

          The order is the order somebody worries in: who does it, is anybody
          actually going through them, did it work last time, can we get back
          in if it stops, and which domains it covers. */}
      <OverviewDetail label="Who signs people in?">
        <Text fontSize="13px">{connection.providerId}</Text>
      </OverviewDetail>

      <OverviewDetail
        label="Is anybody going through it?"
        hint={
          goLive?.routingSwitchedOn
            ? undefined
            : "The connection is on, but people are still signing in the way they did before."
        }
      >
        <IdentityChip
          label={
            goLive?.routingSwitchedOn
              ? "Everybody goes through it"
              : "Not switched on yet"
          }
          tone={goLive?.routingSwitchedOn ? "good" : "warning"}
          data-testid="sso-routing-chip"
        />
      </OverviewDetail>

      <OverviewDetail label="Did it work last time?">
        <Text
          fontSize="13px"
          color={goLive?.testSignIn.done ? undefined : "fg.muted"}
        >
          {goLive?.testSignIn.atMs
            ? `Yes, ${formatDay(goLive.testSignIn.atMs)}`
            : "Never tested"}
        </Text>
      </OverviewDetail>

      <OverviewDetail
        label="Can anybody get back in without it?"
        hint="People who can still sign in with a password if the identity provider stops answering."
      >
        <Text
          fontSize="13px"
          fontVariantNumeric="tabular-nums"
          color={goLive?.breakGlass.inPlace ? undefined : "fg.muted"}
        >
          {peopleCount(goLive?.breakGlass.liveCount ?? 0)}
        </Text>
      </OverviewDetail>

      {connection.issuer && (
        <OverviewDetail label="What does it call itself?">
          {/* AN IDENTIFIER, SET LIKE ONE. It is a URL an administrator
              compares character by character against their provider's
              console, so it is monospaced and it wraps inside its own column
              rather than running off the card — which is what it did while
              the value column refused to shrink. */}
          <Text
            fontSize="12px"
            fontFamily="mono"
            color="fg.muted"
            wordBreak="break-all"
            lineHeight="1.5"
          >
            {connection.issuer}
          </Text>
        </OverviewDetail>
      )}

      <OverviewDetail label="Which domains does it cover?">
        {connection.verifiedDomains.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            No domain is proved yet.
          </Text>
        ) : (
          <HStack gap={1} flexWrap="wrap">
            {connection.verifiedDomains.map((domain) => {
              const chip = domainProofChipFor({
                proved: true,
                proofState: proofByDomain.get(domain)?.proofState ?? "VERIFIED",
                graceEndsAtMs: proofByDomain.get(domain)?.graceEndsAtMs ?? null,
                claim: claims.find((entry) => entry.domain === domain),
              });
              return (
                <IdentityChip
                  key={domain}
                  label={`${domain} · ${chip.label}`}
                  tone={chip.tone}
                  title={chip.title}
                  data-testid="authentication-domain-chip"
                />
              );
            })}
          </HStack>
        )}
      </OverviewDetail>
    </OverviewCard>
  );
}
