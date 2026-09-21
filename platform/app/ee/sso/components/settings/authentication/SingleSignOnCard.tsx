import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { TestSignInFailureNotice } from "@ee/sso/components/TestSignInFailureNotice";
import { useTestSignIn } from "@ee/sso/hooks/useTestSignIn";
import {
  arrivalAnswerLabel,
  SSO_ANSWER_BY_POLICY,
} from "@ee/sso/logic/arrivals";
import {
  connectionProtocolName,
  connectionStatusChipFor,
} from "@ee/sso/logic/connectionStatus";
import { domainProofChipFor } from "@ee/sso/logic/domainProofChip";
import type { SelfServeSetupView } from "@ee/sso/sso-self-serve.types";
import { ArrowRight, ExternalLink, RefreshCw, Settings2 } from "lucide-react";
import { IdentityChip } from "~/components/access/IdentityRow";
import {
  OverviewCard,
  OverviewDetail,
} from "~/components/settings/authentication/OverviewCard";
import { Link } from "~/components/ui/link";
import { identityProviderPreset } from "../singleSignOn/identityProviders";
import { singleSignOnUpdateChipFor } from "../singleSignOn/migration-progress";

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
  const { connection, claims, serviceProvider } = setup;
  // The card shows the last failure; the button that causes one owns the rest
  // of this hook's state (see `SingleSignOnCardActions`).
  const { failure } = useTestSignIn({
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
      chip={connectionStatusChipFor({ state: connection.state })}
      data-testid="single-sign-on-card"
      actions={
        <SingleSignOnCardActions
          connection={connection}
          serviceProvider={serviceProvider}
          canManage={canManage}
        />
      }
    >
      {/* Above the details rather than below them: a test sign-in that just
          failed is the newest thing the reader knows about this connection,
          and it belongs where they are already looking — on the card naming
          the provider that refused, not in a corner for eight seconds. */}
      {failure && <TestSignInFailureNotice failure={failure} />}

      <UpdateNotice setup={setup} canManage={canManage} />

      {/* FOUR ROWS, AND SHORT ONES. An overview card is read at a glance and
          is the wrong place for everything true about a connection: five rows
          with sentence-long labels wrapped onto two lines each and turned a
          card somebody scans into a card somebody has to read. What survives
          is who does the signing in, whether anybody is actually being sent
          through them, what happens to somebody it has never seen, and which
          domains it covers.

          What went: the issuer, a monospace URL nobody compares from here; the
          last test and the ways back in, which are preconditions of going live
          and are already listed as such in the journey one control away. */}
      <OverviewDetail label="Identity provider">
        <Text>{connection.providerId}</Text>
      </OverviewDetail>

      {/* WHO IS ACTUALLY SENT HERE, which the status chip states about the
          CONNECTION and this row states about the PEOPLE. They move together
          now — turning the connection on is the whole decision — so this row
          reads off the same state rather than a switch of its own. */}
      <OverviewDetail
        label="Sign-in"
        hint={
          connection.state === "ACTIVE"
            ? undefined
            : "The connection is not on yet. Everyone signs in the way they do today."
        }
      >
        <IdentityChip
          label={connection.state === "ACTIVE" ? "Everybody" : "Nobody yet"}
          tone={connection.state === "ACTIVE" ? "good" : "warning"}
          data-testid="sso-routing-chip"
        />
      </OverviewDetail>

      {/* READ HERE, CHANGED IN THE JOURNEY. The overview used to offer the
          whole three-answer control beside the journey's, which is one
          question asked in two places with two saves. What survives is the
          fact — which answer is in force — and the value walks the reader to
          the one place it is decided. */}
      <OverviewDetail label="New arrivals">
        <Link
          href="/settings/authentication/provider"
          data-testid="sso-arrivals-value"
        >
          {arrivalAnswerLabel(SSO_ANSWER_BY_POLICY[connection.arrivalPolicy])}
        </Link>
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

/**
 * The one thing on this overview that is not a fact about today.
 *
 * TWO STATES, AND ONLY ONE OF THEM IS AN INVITATION. An organization whose
 * single sign-on LangWatch set up can take it over by connecting its own
 * identity provider, and this is where somebody who never opens the provider
 * page finds that out — with one action, which goes to the step that does it.
 * Once that is under way the same spot reports where it got to instead, in the
 * same words the provider page uses, because two screens with two vocabularies
 * for one state read as two states.
 *
 * Held to `sso:view` by the page above, and the ACTION to `sso:manage`: a
 * reader who cannot act still gets the status, and never a control that would
 * refuse them.
 */
function UpdateNotice({
  setup,
  canManage,
}: {
  setup: LiveSetup;
  canManage: boolean;
}) {
  if (setup.migration) {
    const chip = singleSignOnUpdateChipFor(setup.migration.phase);
    return (
      <OverviewDetail label="Update">
        <HStack gap={2}>
          <IdentityChip
            label={chip.label}
            tone={chip.tone}
            title={chip.title}
            data-testid="sso-update-chip"
          />
          <Link href="/settings/authentication/provider">Where it stands</Link>
        </HStack>
      </OverviewDetail>
    );
  }

  if (setup.connection.source !== "legacy-grandfathered") return null;

  return (
    <Box
      borderWidth="1px"
      borderColor="border.emphasized"
      borderRadius="md"
      padding={3}
      data-testid="sso-update-notice"
    >
      <VStack align="stretch" gap={2}>
        <Text fontSize="13px" color="fg.muted">
          LangWatch set this single sign-on up for your organization. Connect
          your own identity provider to run it yourself.
        </Text>
        {canManage && (
          <Link href="/settings/authentication/provider">
            <Button size="sm" variant="solid" colorPalette="orange">
              Update single sign-on
              <ArrowRight size={14} />
            </Button>
          </Link>
        )}
      </VStack>
    </Box>
  );
}

/**
 * Testing the connection, and the document only SAML publishes.
 *
 * The test button hands the browser to the identity provider and back, so it
 * is marked as LEAVING rather than as acting here; a failed attempt keeps it
 * solid, because the step is still the thing to do.
 */
function SingleSignOnCardActions({
  connection,
  serviceProvider,
  canManage,
}: {
  connection: LiveSetup["connection"];
  serviceProvider: LiveSetup["serviceProvider"];
  canManage: boolean;
}) {
  const { start, sending, failure } = useTestSignIn({
    connectionId: connection.connectionId,
  });
  return (
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
  );
}
