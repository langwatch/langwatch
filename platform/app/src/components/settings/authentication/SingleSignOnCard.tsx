import { Button, HStack, Text } from "@chakra-ui/react";
import type { SelfServeSetupView } from "@langwatch/identity-server";
import { ExternalLink, RefreshCw, Settings2 } from "lucide-react";
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
 *
 * Exported for the connection summary on the provider page, which is the same
 * connection named in a smaller card.
 */
export function ProtocolMark({ type }: { type: string }) {
  const Icon = identityProviderPreset(type).icon;
  return Icon ? <Icon size={14} aria-hidden /> : null;
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
                Metadata
              </Button>
            </Link>
          )}
          {/* WHERE THE REST OF IT IS. This card reads; claiming another
              domain, granting a way back in, changing who it admits and
              taking it down are the journey, which is a page rather than a
              mode of this one. */}
          {canManage && (
            <Link href="/settings/authentication/provider">
              <Button size="sm" variant="ghost">
                <Settings2 size={14} />
                Edit
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

      {/* THREE ROWS, AND SHORT ONES. An overview card is read at a glance and
          is the wrong place for everything true about a connection: five rows
          with sentence-long labels wrapped onto two lines each and turned a
          card somebody scans into a card somebody has to read. What survives
          is who does the signing in, whether anybody is actually being sent
          through them, and which domains it covers.

          What went: the issuer, a monospace URL nobody compares from here; the
          last test and the ways back in, which are preconditions of going live
          and are already listed as such in the journey one control away. */}
      <OverviewDetail label="Identity provider">
        <Text>{connection.providerId}</Text>
      </OverviewDetail>

      <OverviewDetail
        label="Sign-in"
        hint={
          goLive?.routingSwitchedOn
            ? undefined
            : "The connection works. Everyone still signs in the way they do today."
        }
      >
        <IdentityChip
          label={goLive?.routingSwitchedOn ? "Everybody" : "Not switched over"}
          tone={goLive?.routingSwitchedOn ? "good" : "warning"}
          data-testid="sso-routing-chip"
        />
      </OverviewDetail>

      <OverviewDetail label="Verified domains">
        {connection.verifiedDomains.length === 0 ? (
          <Text color="fg.muted">No domain is proved yet.</Text>
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
