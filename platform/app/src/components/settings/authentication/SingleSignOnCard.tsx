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
import { OverviewCard, OverviewDetail } from "./OverviewCard";

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

      <OverviewDetail label="Identity provider">
        <Text fontSize="sm">{connection.providerId}</Text>
      </OverviewDetail>

      {connection.issuer && (
        <OverviewDetail label="Issuer">
          <Text fontSize="sm" color="fg.muted" wordBreak="break-all">
            {connection.issuer}
          </Text>
        </OverviewDetail>
      )}

      <OverviewDetail label="Proved domains">
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
