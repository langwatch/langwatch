import { Link } from "@langwatch/browser-host/link";
import { UpgradeRequired } from "@langwatch/design-system/access-state";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * How everyone signs in, on the Authentication overview: the live connection
 * read, or what a connection would do before there is one. Declared through
 * `withCapabilities`. Spec: specs/identity/organization-authentication-settings.feature
 */
import { Box, Button, HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { OverviewCard, OverviewDetail, StatusChip } from "@langwatch/design-system/settings-card";
import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";
import { ArrowRight, ExternalLink, RefreshCw, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { ssoApi } from "../../behavior/sso-api.ts";
import { useTestSignIn } from "../../behavior/use-test-sign-in.ts";
import { arrivalAnswerLabel, SSO_ANSWER_BY_POLICY } from "../../model/arrivals.ts";
import {
  connectionProtocolName,
  connectionStatusChipFor,
  previewCopyFor,
} from "../../model/connection-status.ts";
import { domainProofChipFor } from "../../model/domain-proof-chip.ts";
import { domainRowsFor } from "../../model/domain-rows.ts";
import { updateChipFor } from "../../model/migration-route.ts";
import { setupProgressFor } from "../../model/setup-progress.ts";
import { domainClaimsOf, goLiveFactsOf, routedDomainEvidenceOf } from "../../model/setup-view.ts";
import { useSsoHost } from "../../model/sso-host.ts";
import { AvailabilityRefusalNotice, LoadFailure } from "../elements/refusals.tsx";
import { TestSignInFailureNotice } from "../elements/test-sign-in-failure-notice.tsx";

const PROVIDER_PAGE = "/settings/authentication/provider";

type SetupConnection = NonNullable<SsoSetupPageView["connection"]>;

export function SsoOverviewCard({ organizationId }: { organizationId: string }) {
  const host = useSsoHost();
  const canManage = host.canManage();
  const canView = host.canView();
  const setup = ssoApi.ssoSetup.getSetup.useQuery({ organizationId }, { enabled: canView });

  if (!canView) return <ReadRefusedCard />;
  if (setup.isLoading) return <Skeleton height="220px" width="full" />;
  if (setup.isError) return <LoadFailure error={setup.error} what="single sign-on" />;

  const view = setup.data;
  const connection = view?.connection ?? null;
  const refusal = view && !view.availability.available ? view.availability.refusal : null;
  // A refusal is said above the cards, and nothing is offered that it would refuse.
  const enterpriseRequired = view?.enterpriseRequired === true;
  const canOffer = canManage && refusal === null && !enterpriseRequired;

  return (
    <VStack align="stretch" gap={3} width="full" height="full">
      {refusal && <AvailabilityRefusalNotice refusal={refusal} />}
      {view && connection?.state === "ACTIVE" ? (
        <SingleSignOnCard view={view} connection={connection} canManage={canOffer} />
      ) : (
        <SingleSignOnPreviewCard
          state={connection?.state ?? null}
          canManage={canOffer}
          enterpriseRequired={enterpriseRequired}
          updatePhase={view?.migration?.phase ?? null}
          goLiveBlockedBecause={
            setupProgressFor(goLiveFactsOf(view?.goLive ?? null)).goLiveBlockedBecause
          }
          domains={view ? <DomainsDetail view={view} canManage={canOffer} /> : void 0}
        />
      )}
    </VStack>
  );
}

export default SsoOverviewCard;

/** A reader the read refused is told who can tell them, never shown a failure. */
function ReadRefusedCard() {
  return (
    <OverviewCard title="Single sign-on" data-testid="sso-read-refused">
      <Text color="fg.muted" data-testid="domains-no-access">
        You need permission to see single sign-on to read how your organization signs in and which
        domains have been proved. An administrator who has it can tell you.
      </Text>
    </OverviewCard>
  );
}

/**
 * Every domain the organization put forward, proved or still waiting on the
 * reader, each once, and the way to prove another. None claimed is said in
 * words rather than left as an empty panel.
 */
function DomainsDetail({ view, canManage }: { view: SsoSetupPageView; canManage: boolean }) {
  const rows = domainRowsFor({
    evidence: view.connection ? routedDomainEvidenceOf(view.connection) : [],
    claims: domainClaimsOf(view.claims),
  });

  return (
    <OverviewDetail label="Domains">
      <VStack align="start" gap={2}>
        {rows.length === 0 ? (
          <Text color="fg.muted" data-testid="domains-empty">
            No domain has been claimed yet.
          </Text>
        ) : (
          <HStack gap={1} flexWrap="wrap">
            {rows.map((row) => {
              const chip = domainProofChipFor(row);
              return (
                <StatusChip
                  key={row.domain}
                  label={`${row.domain} · ${chip.label}`}
                  tone={chip.tone}
                  title={chip.title}
                  data-testid="authentication-domain-chip"
                />
              );
            })}
          </HStack>
        )}
        {canManage && (
          <Button asChild size="sm" variant="outline">
            <Link unstyled href={PROVIDER_PAGE} data-testid="sso-prove-domain">
              <ExternalLink size={14} />
              Prove a domain
            </Link>
          </Button>
        )}
      </VStack>
    </OverviewDetail>
  );
}

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
              <Link unstyled href={PROVIDER_PAGE}>
                <Settings2 size={14} />
                Edit
              </Link>
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
        <Link unstyled href={PROVIDER_PAGE} data-testid="sso-arrivals-value">
          {arrivalAnswerLabel(SSO_ANSWER_BY_POLICY[connection.arrivalPolicy])}
        </Link>
      </OverviewDetail>

      <DomainsDetail view={view} canManage={canManage} />

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
          <Link unstyled href={PROVIDER_PAGE}>
            Where it stands
          </Link>
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
            <Link unstyled href={PROVIDER_PAGE}>
              Update single sign-on
              <ArrowRight size={14} />
            </Link>
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
  enterpriseRequired = false,
  goLiveBlockedBecause = null,
  updatePhase = null,
  domains,
}: {
  state?: SetupConnection["state"] | null;
  canManage?: boolean;
  /** The plan refuses single sign-on: said on the card, no control offered. */
  enterpriseRequired?: boolean;
  goLiveBlockedBecause?: string | null;
  /** Where an update to the organization's own identity provider got to. */
  updatePhase?: NonNullable<SsoSetupPageView["migration"]>["phase"] | null;
  /** The organization's domains, where there was a read to list them from. */
  domains?: ReactNode;
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
            <Link unstyled href={PROVIDER_PAGE} data-testid="single-sign-on-preview-action">
              {copy.action}
              <ArrowRight size={14} />
            </Link>
          </Button>
        ) : (
          void 0
        )
      }
    >
      {enterpriseRequired && (
        <UpgradeRequired
          feature="Single sign-on"
          compact
          data-testid="sso-card-enterprise-gate"
          actions={
            <Button asChild size="sm" colorPalette="orange">
              <Link href="/settings/plans">Compare plans</Link>
            </Button>
          }
        />
      )}

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

      {domains}
    </OverviewCard>
  );
}
