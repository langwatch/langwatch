// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * How everyone signs in, on the Authentication overview: the live connection
 * read, or what a connection would do before there is one. Declared through
 * `withCapabilities`. Spec: specs/identity/organization-authentication-settings.feature
 */
import { Box, Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { OverviewCard, OverviewDetail, StatusChip } from "@langwatch/design-system/settings-card";
import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";
import { ArrowRight, ExternalLink, RefreshCw, Settings2 } from "lucide-react";

import { ssoApi } from "../../behavior/sso-api.ts";
import { useTestSignIn } from "../../behavior/use-test-sign-in.ts";
import { arrivalAnswerLabel, SSO_ANSWER_BY_POLICY } from "../../model/arrivals.ts";
import {
  connectionProtocolName,
  connectionStatusChipFor,
  previewCopyFor,
} from "../../model/connection-status.ts";
import { domainProofChipFor } from "../../model/domain-proof-chip.ts";
import { updateChipFor } from "../../model/migration-route.ts";
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
      updatePhase={view?.migration?.phase ?? null}
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

      <UpdateNotice view={view} connection={connection} canManage={canManage} />
    </OverviewCard>
  );
}

/**
 * The invitation to connect the organization's own identity provider, or,
 * once that is under way, where it got to in the provider page's own words.
 * A reader who may not manage gets the status and never the action.
 */
function UpdateNotice({
  view,
  connection,
  canManage,
}: {
  view: SsoSetupPageView;
  connection: SetupConnection;
  canManage: boolean;
}) {
  if (view.migration) {
    const chip = updateChipFor(view.migration.phase);
    return (
      <OverviewDetail label="Update">
        <HStack gap={2}>
          <StatusChip
            label={chip.label}
            tone={chip.tone}
            title={chip.title}
            data-testid="sso-update-chip"
          />
          <a href={PROVIDER_PAGE}>Where it stands</a>
        </HStack>
      </OverviewDetail>
    );
  }
  if (connection.source !== "legacy-grandfathered") return null;

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
          {canManage
            ? "LangWatch set this single sign-on up for your organization. Connect your own identity provider to run it yourself."
            : "LangWatch set this single sign-on up for your organization. An organization administrator can connect your own identity provider to run it yourselves."}
        </Text>
        {canManage && (
          <Button asChild size="sm" variant="solid" colorPalette="orange">
            <a href={PROVIDER_PAGE}>
              Update single sign-on
              <ArrowRight size={14} />
            </a>
          </Button>
        )}
      </VStack>
    </Box>
  );
}

/** What single sign-on would give this organization, before there is one to read. */
export function SingleSignOnPreviewCard({
  state = null,
  canManage = false,
  goLiveBlockedBecause = null,
  updatePhase = null,
}: {
  state?: SetupConnection["state"] | null;
  canManage?: boolean;
  goLiveBlockedBecause?: string | null;
  /** Where an update to the organization's own identity provider got to. */
  updatePhase?: NonNullable<SsoSetupPageView["migration"]>["phase"] | null;
}) {
  const copy = previewCopyFor({ state, goLiveBlockedBecause, updatePhase });

  return (
    <OverviewCard
      title="Single sign-on"
      chip={copy.chip}
      data-testid="single-sign-on-preview-card"
      actions={
        canManage ? (
          <Button asChild size="sm" variant="solid" colorPalette="orange">
            <a href={PROVIDER_PAGE} data-testid="single-sign-on-preview-action">
              {copy.action}
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

      <OverviewDetail label={copy.stepLabel}>
        <Text color="fg.muted">{copy.step}</Text>
      </OverviewDetail>
    </OverviewCard>
  );
}
