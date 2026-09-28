import {
  Button,
  Field,
  HStack,
  Input,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { ScopeChipPicker } from "~/components/settings/ScopeChipPicker";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { HandledErrorAlert } from "~/features/errors";
import type {
  SlackIntegrationKind,
  SlackIntegrationScopeType,
} from "~/generated/prisma/client";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { DeleteSlackConnectionButton } from "./DeleteSlackConnectionButton";
import { SlackAppSetupCallout } from "./SlackAppSetupCallout";
import { maskedSecret, SLACK_CONNECTION_KINDS } from "./slackConnectionCopy";
import type {
  SlackConnection,
  SlackConnectionSaved,
} from "./slackConnectionTypes";

interface ConnectionScope {
  scopeType: SlackIntegrationScopeType;
  scopeId: string;
}

/** The kind, name, scope and secret of one connection. The kind is chosen once
 *  at create; the secret is replaced only when a new one is typed. */
export function SlackConnectionForm({
  projectId,
  connection,
  canManageProject,
  canManageOrganization,
  onSaved,
  onDeleted,
}: {
  projectId: string;
  connection: SlackConnection | undefined;
  canManageProject: boolean;
  canManageOrganization: boolean;
  onSaved: (saved: SlackConnectionSaved) => void;
  onDeleted: () => void;
}) {
  const { organization, project } = useOrganizationTeamProject();
  const [kind, setKind] = useState<SlackIntegrationKind>(
    connection?.kind ?? "BOT",
  );
  const [name, setName] = useState(connection?.name ?? "");
  const [scopes, setScopes] = useState<ConnectionScope[]>(() =>
    initialScopes({
      connection,
      projectId: canManageProject ? project?.id : undefined,
      organizationId: canManageOrganization ? organization?.id : undefined,
    }),
  );
  const [secret, setSecret] = useState("");
  const [isReplacingSecret, setIsReplacingSecret] = useState(!connection);
  const save = useSaveSlackConnection({ projectId, connection, onSaved });
  const scope = scopes[0];
  const canSave =
    name.trim().length > 0 &&
    !!scope &&
    (!isReplacingSecret || secret.trim().length > 0);

  return (
    <VStack align="stretch" gap={5}>
      <KindField kind={kind} onChange={setKind} isLocked={!!connection} />
      <Field.Root required>
        <Field.Label>Name</Field.Label>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={kind === "BOT" ? "Alerts bot" : "Alerts channel webhook"}
        />
      </Field.Root>
      <ConnectionScopeField
        scopes={scopes}
        onChange={setScopes}
        canManageProject={canManageProject}
        canManageOrganization={canManageOrganization}
      />
      <SecretField
        kind={kind}
        secretHint={connection?.secretHint}
        secret={secret}
        onSecretChange={setSecret}
        isReplacing={isReplacingSecret}
        onReplacingChange={(replacing) => {
          setIsReplacingSecret(replacing);
          setSecret("");
        }}
      />
      <HandledErrorAlert
        error={save.error}
        fallbackTitle="Couldn't save the Slack connection"
      />
      <HStack justify="space-between">
        <Button
          colorPalette="blue"
          disabled={!canSave}
          loading={save.isPending}
          onClick={() =>
            scope &&
            save.run({
              kind,
              name: name.trim(),
              scope,
              secret: isReplacingSecret ? secret.trim() : undefined,
            })
          }
        >
          {connection ? "Save" : "Add connection"}
        </Button>
        {connection ? (
          <DeleteSlackConnectionButton
            projectId={projectId}
            connection={connection}
            onDeleted={onDeleted}
          />
        ) : null}
      </HStack>
    </VStack>
  );
}

/** Offers only the scopes the reader may manage (ADR-093 §5a). */
function ConnectionScopeField({
  scopes,
  onChange,
  canManageProject,
  canManageOrganization,
}: {
  scopes: ConnectionScope[];
  onChange: (scopes: ConnectionScope[]) => void;
  canManageProject: boolean;
  canManageOrganization: boolean;
}) {
  const { organization, project } = useOrganizationTeamProject();
  return (
    <ScopeChipPicker<SlackIntegrationScopeType>
      value={scopes}
      onChange={onChange}
      organizationId={organization?.id}
      organizationName={organization?.name}
      projectId={project?.id}
      projectName={project?.name}
      allowedScopeTypes={["ORGANIZATION", "PROJECT"]}
      singleSelect
      label="Who can use it"
      subjectNoun="connection"
      currentOrganizationId={canManageOrganization ? organization?.id : null}
      currentProjectId={canManageProject ? project?.id : null}
    />
  );
}

function initialScopes({
  connection,
  projectId,
  organizationId,
}: {
  connection: SlackConnection | undefined;
  projectId: string | undefined;
  organizationId: string | undefined;
}): ConnectionScope[] {
  if (connection) {
    return [{ scopeType: connection.scopeType, scopeId: connection.scopeId }];
  }
  if (projectId) return [{ scopeType: "PROJECT", scopeId: projectId }];
  if (organizationId) {
    return [{ scopeType: "ORGANIZATION", scopeId: organizationId }];
  }
  return [];
}

/** Create and update as one save, reporting through the form's inline alert:
 *  a refused secret (already stored, or rejected by Slack) belongs next to the
 *  field that holds it, not in a toast that disappears. */
function useSaveSlackConnection({
  projectId,
  connection,
  onSaved,
}: {
  projectId: string;
  connection: SlackConnection | undefined;
  onSaved: (saved: SlackConnectionSaved) => void;
}) {
  const utils = api.useUtils();
  const create = api.slackIntegration.create.useMutation();
  const update = api.slackIntegration.update.useMutation();
  const done = (saved: SlackConnectionSaved, title: string) => {
    void utils.slackIntegration.list.invalidate();
    toaster.create({ type: "success", title });
    onSaved(saved);
  };

  const run = ({
    kind,
    name,
    scope,
    secret,
  }: {
    kind: SlackIntegrationKind;
    name: string;
    scope: ConnectionScope;
    secret: string | undefined;
  }) => {
    if (connection) {
      update.mutate(
        { projectId, id: connection.id, name, ...scope, secret },
        {
          onSuccess: () =>
            done(
              { connectionId: connection.id, name, kind: connection.kind },
              "Slack connection saved",
            ),
        },
      );
      return;
    }
    create.mutate(
      { projectId, name, kind, ...scope, secret: secret ?? "" },
      {
        onSuccess: (created) =>
          done(
            { connectionId: created.id, name, kind: created.kind },
            "Slack connection added",
          ),
      },
    );
  };

  return {
    run,
    error: create.error ?? update.error,
    isPending: create.isPending || update.isPending,
  };
}

function KindField({
  kind,
  onChange,
  isLocked,
}: {
  kind: SlackIntegrationKind;
  onChange: (kind: SlackIntegrationKind) => void;
  isLocked: boolean;
}) {
  if (isLocked) {
    const current = SLACK_CONNECTION_KINDS.find((k) => k.value === kind);
    return (
      <Field.Root>
        <Field.Label>Type</Field.Label>
        <Text fontSize="sm">{current?.title}</Text>
        <Field.HelperText>{current?.description}</Field.HelperText>
      </Field.Root>
    );
  }
  return (
    <RadioCard.Root
      value={kind}
      onValueChange={({ value }) => {
        const next = SLACK_CONNECTION_KINDS.find((k) => k.value === value);
        if (next) onChange(next.value);
      }}
    >
      <RadioCard.Label>Type</RadioCard.Label>
      <VStack align="stretch" gap={2}>
        {SLACK_CONNECTION_KINDS.map((option) => (
          <RadioCard.Item key={option.value} value={option.value}>
            <RadioCard.ItemHiddenInput />
            <RadioCard.ItemControl cursor="pointer">
              <RadioCard.ItemContent>
                <RadioCard.ItemText>{option.title}</RadioCard.ItemText>
                <RadioCard.ItemDescription>
                  {option.description}
                </RadioCard.ItemDescription>
              </RadioCard.ItemContent>
              <RadioCard.ItemIndicator />
            </RadioCard.ItemControl>
          </RadioCard.Item>
        ))}
      </VStack>
    </RadioCard.Root>
  );
}

/** A saved secret shows only its last four characters; typing a new one is
 *  an explicit Replace, so leaving the field alone keeps the stored secret. */
function SecretField({
  kind,
  secretHint,
  secret,
  onSecretChange,
  isReplacing,
  onReplacingChange,
}: {
  kind: SlackIntegrationKind;
  secretHint: string | undefined;
  secret: string;
  onSecretChange: (secret: string) => void;
  isReplacing: boolean;
  onReplacingChange: (replacing: boolean) => void;
}) {
  const isBot = kind === "BOT";
  const label = isBot ? "Bot User OAuth token" : "Webhook URL";
  if (!isReplacing && secretHint !== undefined) {
    return (
      <Field.Root>
        <Field.Label>{label}</Field.Label>
        <HStack gap={3}>
          <Text fontSize="sm" fontFamily="mono">
            {maskedSecret(secretHint)}
          </Text>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onReplacingChange(true)}
          >
            Replace
          </Button>
        </HStack>
      </Field.Root>
    );
  }
  return (
    <VStack align="stretch" gap={2}>
      {isBot ? <SlackAppSetupCallout /> : <WebhookHelp />}
      <Field.Root required>
        <Field.Label>{label}</Field.Label>
        <Input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => onSecretChange(event.target.value)}
          placeholder={isBot ? "xoxb-…" : "https://hooks.slack.com/services/…"}
        />
        {secretHint !== undefined ? (
          <Field.HelperText>
            Every automation using this connection switches to the new secret
            when you save.{" "}
            <Button
              variant="plain"
              size="xs"
              height="auto"
              paddingX={0}
              onClick={() => onReplacingChange(false)}
            >
              Keep the current one
            </Button>
          </Field.HelperText>
        ) : null}
      </Field.Root>
    </VStack>
  );
}

function WebhookHelp() {
  return (
    <Text fontSize="xs" color="fg.muted">
      Create an incoming webhook for the channel in your Slack app, then paste
      its URL.{" "}
      <Link
        href="https://api.slack.com/messaging/webhooks"
        target="_blank"
        rel="noopener noreferrer"
      >
        How to create one
      </Link>
    </Text>
  );
}
