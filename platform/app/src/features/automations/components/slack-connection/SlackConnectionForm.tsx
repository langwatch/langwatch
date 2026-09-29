import {
  Button,
  Field,
  HStack,
  Input,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
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
import {
  type ConnectionScope,
  type SlackConnectionDraft,
  useSlackConnectionFormState,
} from "./useSlackConnectionFormState";

interface SlackConnectionFormProps {
  projectId: string;
  connection: SlackConnection | undefined;
  canManageProject: boolean;
  canManageOrganization: boolean;
  onSaved: (saved: SlackConnectionSaved) => void;
  onDeleted: () => void;
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
}: SlackConnectionFormProps) {
  const form = useSlackConnectionFormState({
    connection,
    canManageProject,
    canManageOrganization,
  });
  const save = useSaveSlackConnection({ projectId, connection, onSaved });

  return (
    <VStack align="stretch" gap={5}>
      <KindField
        kind={form.kind}
        onChange={form.setKind}
        isLocked={!!connection}
      />
      <ConnectionNameField
        name={form.name}
        kind={form.kind}
        onChange={form.setName}
        isInvalid={form.errors.name}
      />
      <ConnectionScopeField
        scopes={form.scopes}
        onChange={form.setScopes}
        canManageProject={canManageProject}
        canManageOrganization={canManageOrganization}
        isInvalid={form.errors.scope}
      />
      <SecretField
        kind={form.kind}
        secretHint={connection?.secretHint}
        secret={form.secret}
        onSecretChange={form.setSecret}
        isReplacing={form.isReplacingSecret}
        onReplacingChange={form.changeReplacing}
        isInvalid={form.errors.secret}
      />
      <HandledErrorAlert
        error={save.error}
        fallbackTitle="Couldn't save the Slack connection"
      />
      <SlackConnectionFormFooter
        projectId={projectId}
        connection={connection}
        isSaving={save.isPending}
        onSave={() => {
          const draft = form.submit();
          if (draft) save.run(draft);
        }}
        onDeleted={onDeleted}
      />
    </VStack>
  );
}

function ConnectionNameField({
  name,
  kind,
  onChange,
  isInvalid,
}: {
  name: string;
  kind: SlackIntegrationKind;
  onChange: (name: string) => void;
  isInvalid: boolean;
}) {
  return (
    <Field.Root required invalid={isInvalid}>
      <Field.Label>Name</Field.Label>
      <Input
        value={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder={kind === "BOT" ? "Alerts bot" : "Alerts channel webhook"}
      />
      <Field.ErrorText>Give the connection a name.</Field.ErrorText>
    </Field.Root>
  );
}

/** Save stays enabled except while a save is in flight; the handler validates. */
function SlackConnectionFormFooter({
  projectId,
  connection,
  isSaving,
  onSave,
  onDeleted,
}: {
  projectId: string;
  connection: SlackConnection | undefined;
  isSaving: boolean;
  onSave: () => void;
  onDeleted: () => void;
}) {
  return (
    <HStack justify="space-between">
      <Button
        colorPalette="blue"
        disabled={isSaving}
        loading={isSaving}
        onClick={onSave}
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
  );
}

/** Offers only the scopes the reader may manage (ADR-093 §5a). */
function ConnectionScopeField({
  scopes,
  onChange,
  canManageProject,
  canManageOrganization,
  isInvalid,
}: {
  scopes: ConnectionScope[];
  onChange: (scopes: ConnectionScope[]) => void;
  canManageProject: boolean;
  canManageOrganization: boolean;
  isInvalid: boolean;
}) {
  const { organization, project } = useOrganizationTeamProject();
  return (
    <Field.Root invalid={isInvalid}>
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
      <Field.ErrorText>Choose who can use the connection.</Field.ErrorText>
    </Field.Root>
  );
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

  const run = ({ kind, name, scope, secret }: SlackConnectionDraft) => {
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

interface SecretFieldProps {
  kind: SlackIntegrationKind;
  secretHint: string | undefined;
  secret: string;
  onSecretChange: (secret: string) => void;
  isReplacing: boolean;
  onReplacingChange: (replacing: boolean) => void;
  isInvalid: boolean;
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
  isInvalid,
}: SecretFieldProps) {
  const isBot = kind === "BOT";
  const label = isBot ? "Bot User OAuth token" : "Webhook URL";
  if (!isReplacing && secretHint !== undefined) {
    return (
      <SavedSecretField
        label={label}
        secretHint={secretHint}
        onReplace={() => onReplacingChange(true)}
      />
    );
  }
  return (
    <VStack align="stretch" gap={2}>
      {isBot ? <SlackAppSetupCallout /> : <WebhookHelp />}
      <Field.Root required invalid={isInvalid}>
        <Field.Label>{label}</Field.Label>
        <Input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => onSecretChange(event.target.value)}
          placeholder={isBot ? "xoxb-…" : "https://hooks.slack.com/services/…"}
        />
        <Field.ErrorText>
          {isBot ? "Paste the bot token." : "Paste the webhook URL."}
        </Field.ErrorText>
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

/** A stored secret, shown as its last four characters with a Replace button. */
function SavedSecretField({
  label,
  secretHint,
  onReplace,
}: {
  label: string;
  secretHint: string;
  onReplace: () => void;
}) {
  return (
    <Field.Root>
      <Field.Label>{label}</Field.Label>
      <HStack gap={3}>
        <Text fontSize="sm" fontFamily="mono">
          {maskedSecret(secretHint)}
        </Text>
        <Button size="xs" variant="outline" onClick={onReplace}>
          Replace
        </Button>
      </HStack>
    </Field.Root>
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
