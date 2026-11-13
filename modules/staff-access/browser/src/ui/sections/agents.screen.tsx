/**
 * `/ops/agents`: enrol the coding agents that may ask you for access, watch every operator's
 * sessions, and end them. Spec: modules/staff-access/specs/staff-access-pages.feature
 */

import { Link } from "@langwatch/browser-host/link";
import { AccessState } from "@langwatch/design-system/access-state";
import { Card } from "@langwatch/design-system/card";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Button, Heading, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { HandledErrorAlert } from "@langwatch/error-views";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import type {
  StaffAccessOverview,
  StaffAccessRequesterView,
  StaffAccessSessionView,
} from "@langwatch/staff-access-contract";
import { Plus, ShieldOff } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useAgentsOverview } from "../../behavior/use-agents-overview.ts";
import { useNowMs } from "../../behavior/use-now-ms.ts";
import { isRevocable } from "../../model/approval-view.ts";
import { RequestersTable } from "../blocks/requesters-table.tsx";
import { SessionsTable } from "../blocks/sessions-table.tsx";
import { EnrolAgentDialog } from "./enrol-agent-dialog.tsx";
import { RevokeAllDialog } from "./revoke-all-dialog.tsx";

export default function AgentsScreen() {
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Agent access</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container width="fill">
        <AgentsContent />
      </PageLayout.Container>
    </>
  );
}

export function AgentsContent() {
  const agents = useAgentsOverview();
  const { overview } = agents;

  if (readHandledError(overview.error)?.code === "not_found") {
    return (
      <AccessState
        kind="unavailable"
        data-testid="staff-access-not-found"
        title="Page not found"
        description="There is nothing at this address."
      />
    );
  }
  if (overview.error) {
    return (
      <HandledErrorAlert
        error={overview.error}
        fallbackTitle="Couldn't load agent access"
        onRetry={() => void overview.refetch()}
      />
    );
  }
  if (!overview.data) return <SkeletonRows rows={8} />;
  return <AgentsBody data={overview.data} agents={agents} />;
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <VStack align="stretch" gap={3}>
      <HStack justify="space-between" align="end" gap={4} wrap="wrap">
        <VStack align="start" gap={0.5}>
          <Heading as="h2" size="md">
            {title}
          </Heading>
          <Text textStyle="bodySm" color="fg.muted">
            {description}
          </Text>
        </VStack>
        {action}
      </HStack>
      {children}
    </VStack>
  );
}

function AgentsBody({
  data,
  agents,
}: {
  data: StaffAccessOverview;
  agents: ReturnType<typeof useAgentsOverview>;
}) {
  const nowMs = useNowMs({ running: false });
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [revokingAgent, setRevokingAgent] = useState<StaffAccessRequesterView | null>(null);
  const [endingSession, setEndingSession] = useState<StaffAccessSessionView | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const run = async (action: () => Promise<void>, done: () => void) => {
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(error);
    } finally {
      done();
    }
  };

  return (
    <VStack align="stretch" gap={10}>
      {failure !== null && <HandledErrorAlert error={failure} />}

      <Section
        title="Your agents"
        description="An enrolled coding agent can ask you for one hour of access. You approve each request with your passkey."
        action={
          data.hasPasskey ? (
            <Button
              colorPalette="accent"
              size="sm"
              onClick={() => setEnrolOpen(true)}
              data-testid="staff-access-enrol-button"
            >
              <Plus />
              Enrol an agent
            </Button>
          ) : null
        }
      >
        {data.hasPasskey ? (
          <RequestersTable requesters={data.requesters} onRevoke={setRevokingAgent} />
        ) : (
          <AccessState
            kind="permission"
            compact
            data-testid="staff-access-passkey-required"
            title="Add a passkey before you enrol an agent"
            description="Every access request is approved with your passkey, so you need one on your account first."
            actions={
              <Button asChild size="sm" colorPalette="accent">
                <Link href="/settings/security" data-testid="staff-access-add-passkey-link">
                  Add a passkey
                </Link>
              </Button>
            }
          />
        )}
      </Section>

      <Section
        title="Sessions"
        description="Live and recent access from every operator's agents, newest first."
      >
        <SessionsTable
          sessions={data.sessions}
          isRevocable={(session) => isRevocable({ session, nowMs })}
          onRevoke={setEndingSession}
        />
      </Section>

      <Card
        title="Revoke all agent access"
        description="Ends every live session from every operator at once. Use it if a key or a machine may be compromised."
        icon={<ShieldOff />}
        status="bad"
        actions={
          <Button
            colorPalette="red"
            size="sm"
            onClick={() => setRevokeAllOpen(true)}
            data-testid="staff-access-revoke-all-button"
          >
            Revoke all agent access
          </Button>
        }
      />

      <EnrolAgentDialog
        open={enrolOpen}
        onClose={() => setEnrolOpen(false)}
        enrolling={agents.enrolling}
        enrolAgent={agents.enrolAgent}
      />
      <RevokeAllDialog
        open={revokeAllOpen}
        onClose={() => setRevokeAllOpen(false)}
        revoking={agents.revokingEverything}
        revokeEverything={agents.revokeEverything}
      />
      <ConfirmDialog
        open={revokingAgent !== null}
        onClose={() => setRevokingAgent(null)}
        title={`Revoke ${revokingAgent?.name ?? "this agent"}`}
        description="Its key stops working, it can no longer ask you for access, and every session and request it holds ends now."
        confirmLabel="Revoke"
        loading={agents.revokingAgent}
        onConfirm={() => {
          const requester = revokingAgent;
          if (!requester) return;
          void run(
            () => agents.revokeAgent({ requesterId: requester.id }),
            () => setRevokingAgent(null),
          );
        }}
      />
      <ConfirmDialog
        open={endingSession !== null}
        onClose={() => setEndingSession(null)}
        title="Revoke this session"
        description={`The agent's access to ${endingSession?.organizationName ?? "this organization"} ends now and its key stops working.`}
        confirmLabel="Revoke"
        loading={agents.endingSession}
        onConfirm={() => {
          const session = endingSession;
          if (!session) return;
          void run(
            () => agents.endSession({ requestId: session.requestId }),
            () => setEndingSession(null),
          );
        }}
      />
    </VStack>
  );
}
