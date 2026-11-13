/**
 * `/ops/agents/approve/:requestId`: the operator reads what their agent asked for and approves it
 * with a passkey, or denies it. Spec: modules/staff-access/specs/staff-access-pages.feature
 */

import { useRouter } from "@langwatch/browser-host/use-router";
import { AccessState } from "@langwatch/design-system/access-state";
import { Banner } from "@langwatch/design-system/banner";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Alert,
  Button,
  Field,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { HandledErrorAlert } from "@langwatch/error-views";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import type { StaffAccessApprovalView } from "@langwatch/staff-access-contract";
import { toEpochMs } from "@langwatch/time";
import { KeyRound } from "lucide-react";
import { useState } from "react";

import { useApproval } from "../../behavior/use-approval.ts";
import { useNowMs } from "../../behavior/use-now-ms.ts";
import {
  approvalPhase,
  canApprove,
  formatCountdown,
  isTypedNameRequired,
  type ApprovalPhase,
} from "../../model/approval-view.ts";
import { RequestDetails } from "../blocks/request-details.tsx";
import { PasskeyFailure } from "../elements/passkey-failure.tsx";

export default function ApproveRequestScreen() {
  const router = useRouter();
  const requestId = router.params.requestId ?? router.query.requestId ?? "";
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Approve agent access</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container width="narrow">
        <ApproveRequestContent requestId={requestId} />
      </PageLayout.Container>
    </>
  );
}

export function ApproveRequestContent({ requestId }: { requestId: string }) {
  const approval = useApproval({ requestId });
  const { request } = approval;

  if (requestId === "" || readHandledError(request.error)?.code === "not_found") {
    return <RequestNotFound />;
  }
  if (request.error) {
    return (
      <HandledErrorAlert
        error={request.error}
        fallbackTitle="Couldn't load this request"
        onRetry={() => void request.refetch()}
      />
    );
  }
  if (!request.data) return <SkeletonRows rows={6} />;
  return <ApprovalBody view={request.data} approval={approval} />;
}

function RequestNotFound() {
  return (
    <AccessState
      kind="unavailable"
      data-testid="staff-access-request-not-found"
      title="Request not found"
      description="There is no access request at this address, or it was made by another operator's agent. Only the operator who enrolled the agent can open it."
    />
  );
}

function ApprovalBody({
  view,
  approval,
}: {
  view: StaffAccessApprovalView;
  approval: ReturnType<typeof useApproval>;
}) {
  const nowMs = useNowMs({ running: view.status === "pending" });
  const phase = approvalPhase({ view, nowMs });
  const msLeft = toEpochMs(view.expiresAt) - nowMs;

  return (
    <VStack align="stretch" gap={6}>
      <PhaseBanner phase={phase} view={view} />
      <RequestDetails
        view={view}
        expiry={
          phase === "pending" ? (
            <Text data-testid="staff-access-approval-countdown">
              {`In ${formatCountdown(msLeft)} unless you decide first`}
            </Text>
          ) : (
            <Text color="fg.muted">
              <FormattedDate value={view.expiresAt} display="datetime" />
            </Text>
          )
        }
      />
      {phase === "pending" && <Decision view={view} approval={approval} />}
    </VStack>
  );
}

function PhaseBanner({ phase, view }: { phase: ApprovalPhase; view: StaffAccessApprovalView }) {
  if (phase === "expired") {
    return (
      <Banner
        status="warning"
        placement="inline"
        title="This request expired"
        data-testid="staff-access-phase-expired"
      >
        Nothing was approved. Ask the agent to request access again.
      </Banner>
    );
  }
  if (phase === "approved") {
    return (
      <Banner
        status="success"
        placement="inline"
        title="Approved"
        data-testid="staff-access-phase-approved"
      >
        {view.spendApproved
          ? "The agent can now pick up its key, including runs that spend the organization's money. Access lasts one hour from pickup."
          : "The agent can now pick up its key. Access lasts one hour from pickup."}
      </Banner>
    );
  }
  if (phase === "lapsed") {
    return (
      <Banner
        status="info"
        placement="inline"
        title="Approval lapsed"
        data-testid="staff-access-phase-lapsed"
      >
        The agent never picked up its key, so it got no access. Ask it to request access again.
      </Banner>
    );
  }
  if (phase === "live") {
    return (
      <Banner
        status="success"
        placement="inline"
        title="In use"
        data-testid="staff-access-phase-live"
      >
        The agent picked up its key. Access lasts one hour from pickup.
      </Banner>
    );
  }
  if (phase === "ended") {
    return (
      <Banner status="info" placement="inline" title="Ended" data-testid="staff-access-phase-ended">
        The agent's hour of access is over and its key no longer works.
      </Banner>
    );
  }
  if (phase === "denied") {
    return (
      <Banner
        status="info"
        placement="inline"
        title="Denied"
        data-testid="staff-access-phase-denied"
      >
        This request was denied. The agent gets no access from it.
      </Banner>
    );
  }
  if (phase === "revoked") {
    return (
      <Banner
        status="info"
        placement="inline"
        title="Revoked"
        data-testid="staff-access-phase-revoked"
      >
        This access was revoked and its key no longer works.
      </Banner>
    );
  }
  return null;
}

function Decision({
  view,
  approval,
}: {
  view: StaffAccessApprovalView;
  approval: ReturnType<typeof useApproval>;
}) {
  const [spendApproved, setSpendApproved] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [nameError, setNameError] = useState(false);
  const typedNameRequired = isTypedNameRequired({ view, spendApproved });
  const hasContent = view.scopes.includes("org:content");

  const submit = () => {
    if (!canApprove({ view, spendApproved, typedName })) {
      setNameError(true);
      return;
    }
    setNameError(false);
    void approval.approveWithPasskey({
      spendApproved,
      typedOrganizationName: typedNameRequired ? typedName.trim() : void 0,
    });
  };

  return (
    <VStack
      as="form"
      align="stretch"
      gap={5}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {hasContent && (
        <Alert.Root status="warning" data-testid="staff-access-content-warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>This opens the customer's own data</Alert.Title>
            <Alert.Description>
              The agent will read traces, datasets and runs, which can hold personal data. Approve
              only what the reason needs.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {view.spendOffered && (
        <Checkbox
          checked={spendApproved}
          onCheckedChange={(details) => {
            setSpendApproved(details.checked === true);
            setNameError(false);
          }}
          inputProps={{ "data-testid": "staff-access-spend-tick" } as Record<string, string>}
        >
          <VStack align="start" gap={0}>
            <Text textStyle="label">Allow runs that spend money</Text>
            <Text textStyle="bodySm" color="fg.muted">
              Evaluations, experiments and scenario runs bill the organization's model providers.
              Leave this off unless the reason needs a run.
            </Text>
          </VStack>
        </Checkbox>
      )}

      {typedNameRequired && (
        <Field.Root invalid={nameError}>
          <Field.Label>
            Type the organization name to confirm: {view.organizationName ?? ""}
          </Field.Label>
          <Input
            value={typedName}
            autoComplete="off"
            data-testid="staff-access-typed-name-input"
            onChange={(event) => {
              setTypedName(event.target.value);
              setNameError(false);
            }}
          />
          <Field.ErrorText>Type the organization name exactly as shown.</Field.ErrorText>
        </Field.Root>
      )}

      {approval.failure !== null && <PasskeyFailure failure={approval.failure} onRetry={submit} />}

      <HStack gap={3} justify="end">
        <Button
          variant="outline"
          loading={approval.denying}
          disabled={approval.signing}
          onClick={() => void approval.denyRequest()}
          data-testid="staff-access-deny-button"
        >
          Deny
        </Button>
        <Button
          type="submit"
          colorPalette="accent"
          loading={approval.signing}
          disabled={approval.denying}
          data-testid="staff-access-approve-button"
        >
          <KeyRound />
          Approve with passkey
        </Button>
      </HStack>
    </VStack>
  );
}
