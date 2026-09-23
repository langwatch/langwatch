// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * How everyone signs in, on the Authentication overview: the live connection
 * read, or what a connection would do before there is one. Declared through
 * `withCapabilities`. Spec: specs/identity/organization-authentication-settings.feature
 */
import { Button, HStack, Skeleton, Text } from "@chakra-ui/react";
import {
  OverviewCard,
  OverviewDetail,
  StatusChip,
  type OverviewChip,
} from "@langwatch/design-system/settings-card";
import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";
import { ArrowRight, ExternalLink, RefreshCw, Settings2 } from "lucide-react";

import { ssoApi } from "../../behavior/sso-api.ts";
import { useTestSignIn } from "../../behavior/use-test-sign-in.ts";
import { arrivalAnswerLabel, SSO_ANSWER_BY_POLICY } from "../../model/arrivals.ts";
import { connectionProtocolName, connectionStatusChipFor } from "../../model/connection-status.ts";
import { domainProofChipFor } from "../../model/domain-proof-chip.ts";
import { setupProgressFor } from "../../model/setup-progress.ts";
import { domainClaimsOf, goLiveFactsOf } from "../../model/setup-view.ts";
import { useSsoHost } from "../../model/sso-host.ts";
import { LoadFailure } from "../elements/refusals.tsx";
import { TestSignInFailureNotice } from "../elements/test-sign-in-failure-notice.tsx";

const PROVIDER_PAGE = "/settings/authentication/provider";

type SetupConnection = NonNullable<SsoSetupPageView["connection"]>;

export function SsoOverviewCard({ organizationId }: { organizationId: string }) {
  const canManage = useSsoHost().canManage();
  const setup = ssoApi.ssoSetup.getSetup.useQuery({ organizationId });

  if (setup.isLoading) return <Skeleton height="220px" width="full" />;
  if (setup.isError) return <LoadFailure error={setup.error} what="single sign-on" />;

  const view = setup.data;
  const connection = view?.connection ?? null;

  if (view && connection?.state === "ACTIVE") {
    return <SingleSignOnCard view={view} connection={connection} canManage={canManage} />;
  }

  return (
    <SingleSignOnPreviewCard
      state={connection?.state ?? null}
      canManage={canManage}
      goLiveBlockedBecause={
        setupProgressFor(goLiveFactsOf(view?.goLive ?? null)).goLiveBlockedBecause
      }
    />
  );
}

export default SsoOverviewCard;

/** A live connection, named by its protocol; the chip says where it stands in words. */
export function SingleSignOnCard({
  view,
  connection,
  canManage,
}: {
  view: SsoSetupPageView;
  connection: SetupConnection;
  canManage: boolean;
}) {
  const testSignIn = useTestSignIn({ connectionId: connection.connectionId });
  const proofByDomain = new Map(connection.domainProofs.map((proof) => [proof.domain, proof]));
  const claims = domainClaimsOf(view.claims);
  const active = connection.state === "ACTIVE";

  return (
    <OverviewCard
      title={connectionProtocolName(connection.type)}
      chip={connectionStatusChipFor({ state: connection.state })}
      data-testid="single-sign-on-card"
      actions={
        <>
          {canManage && (
            <Button
              size="sm"
              variant={testSignIn.failure ? "solid" : "outline"}
              loading={testSignIn.sending}
              onClick={() => void testSignIn.start()}
            >
              {testSignIn.failure ? <RefreshCw size={14} /> : <ExternalLink size={14} />}
              {testSignIn.failure ? "Try the sign-in again" : "Test sign-in"}
            </Button>
          )}
          {connection.type === "saml" && (
            <Button asChild size="sm" variant="ghost">
              <a href={view.serviceProvider.metadataUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} />
                Metadata
              </a>
            </Button>
          )}
          {canManage && (
            <Button asChild size="sm" variant="ghost">
              <a href={PROVIDER_PAGE}>
                <Settings2 size={14} />
                Edit
              </a>
            </Button>
          )}
        </>
      }
    >
      {testSignIn.failure && <TestSignInFailureNotice failure={testSignIn.failure} />}

      <OverviewDetail label="Identity provider">
        <Text>{connection.providerId}</Text>
      </OverviewDetail>

      <OverviewDetail
        label="Sign-in"
        hint={
          active ? void 0 : "The connection is not on yet. Everyone signs in the way they do today."
        }
      >
        <StatusChip
          label={active ? "Everybody" : "Nobody yet"}
          tone={active ? "good" : "warning"}
          data-testid="sso-routing-chip"
        />
      </OverviewDetail>

      <OverviewDetail label="New arrivals">
        <a href={PROVIDER_PAGE} data-testid="sso-arrivals-value">
          {arrivalAnswerLabel(SSO_ANSWER_BY_POLICY[connection.arrivalPolicy])}
        </a>
      </OverviewDetail>

      <OverviewDetail label="Verified domains">
        {connection.verifiedDomains.length === 0 ? (
          <Text color="fg.muted">No domain is proved yet.</Text>
        ) : (
          <HStack gap={1} flexWrap="wrap">
            {connection.verifiedDomains.map((domain) => {
              const proof = proofByDomain.get(domain);
              const chip = domainProofChipFor({
                proved: true,
                proofState: proof?.proofState ?? "VERIFIED",
                graceEndsAtMs: proof?.graceEndsAtMs ?? null,
                claim: claims.find((entry) => entry.domain === domain),
              });
              return (
                <StatusChip
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

/** What single sign-on would give this organization, before there is one to read. */
export function SingleSignOnPreviewCard({
  state,
  canManage,
  goLiveBlockedBecause,
}: {
  state: SetupConnection["state"] | null;
  canManage: boolean;
  goLiveBlockedBecause: string | null;
}) {
  const chip: OverviewChip =
    state === null
      ? {
          label: "Not set up",
          tone: "neutral",
          title: "No identity provider is connected to this organization.",
        }
      : connectionStatusChipFor({ state, goLiveBlockedBecause });

  return (
    <OverviewCard
      title="Single sign-on"
      chip={chip}
      data-testid="single-sign-on-preview-card"
      actions={
        canManage ? (
          <Button asChild size="sm" variant="solid" colorPalette="orange">
            <a href={PROVIDER_PAGE}>
              {state === null ? "Set it up" : "Carry on setting it up"}
              <ArrowRight size={14} />
            </a>
          </Button>
        ) : (
          void 0
        )
      }
    >
      <OverviewDetail label="What it does">
        <Text>
          Your people sign in with your company&apos;s identity provider, and you decide there who
          still has access.
        </Text>
      </OverviewDetail>

      <OverviewDetail label="Who it applies to">
        <Text>Anyone with an address at a domain you prove is yours.</Text>
      </OverviewDetail>

      <OverviewDetail label={state === null ? "First step" : "Next step"}>
        <Text color="fg.muted">
          {state === null
            ? "Telling us about your identity provider."
            : "Carry on where you left off."}
        </Text>
      </OverviewDetail>
    </OverviewCard>
  );
}
