import {
  Button,
  Field,
  HStack,
  Input,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { ScopeChipPicker } from "~/components/settings/ScopeChipPicker";
import { Link } from "~/components/ui/link";
import { HandledErrorAlert } from "~/features/errors";
import type {
  SlackIntegrationKind,
  SlackIntegrationScopeType,
} from "~/generated/prisma/client";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { DeleteSlackConnectionButton } from "./DeleteSlackConnectionButton";
import { SlackAppSetupCallout } from "./SlackAppSetupCallout";
import {
  maskedSecret,
  narrowingConfirmation,
  SLACK_CONNECTION_KINDS,
} from "./slackConnectionCopy";
import type {
  SlackConnection,
  SlackConnectionSaved,
} from "./slackConnectionTypes";
import { useSaveSlackConnection } from "./useSaveSlackConnection";
import {
  type ConnectionScope,
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
  const errorText = form.errorTexts(save.fieldRefusal);

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
        errorText={errorText.scope}
      />
      <SecretField
        kind={form.kind}
        secretHint={connection?.secretHint}
        secret={form.secret}
        onSecretChange={form.setSecret}
        isReplacing={form.isReplacingSecret}
        onReplacingChange={form.changeReplacing}
        errorText={errorText.secret}
      />
      <SlackConnectionFormFooter
        projectId={projectId}
        connection={connection}
        save={save}
        onSave={() => {
          const draft = form.submit();
          if (draft) save.run(draft);
        }}
        onDeleted={onDeleted}
      />
    </VStack>
  );
}

/** Asks before an organization connection other projects use is narrowed. */
function NarrowingConfirmDialog({
  name,
  count,
  isSaving,
  onConfirm,
  onCancel,
}: {
  name: string;
  count: number | null;
  isSaving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmation = narrowingConfirmation({ name, count: count ?? 0 });
  return (
    <ConfirmDialog
      open={count !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={confirmation.title}
      message={confirmation.message}
      confirmLabel={confirmation.confirmLabel}
      tone="danger"
      loading={isSaving}
      onConfirm={onConfirm}
    />
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

/** The save's outcome and its buttons. Save stays enabled except while a save
 *  is in flight (the handler validates), and a refused narrowing opens its
 *  confirmation here, beside the Save it came from. */
function SlackConnectionFormFooter({
  projectId,
  connection,
  save,
  onSave,
  onDeleted,
}: {
  projectId: string;
  connection: SlackConnection | undefined;
  save: ReturnType<typeof useSaveSlackConnection>;
  onSave: () => void;
  onDeleted: () => void;
}) {
  return (
    <>
      <HandledErrorAlert
        error={save.error}
        fallbackTitle="Couldn't save the Slack connection"
      />
      <HStack justify="space-between">
        <Button
          colorPalette="blue"
          disabled={save.isPending}
          loading={save.isPending}
          onClick={onSave}
        >
          {connection ? "Save" : "Add connection"}
        </Button>
        {connection ? (
          <>
            <DeleteSlackConnectionButton
              projectId={projectId}
              connection={connection}
              onDeleted={onDeleted}
            />
            <NarrowingConfirmDialog
              name={connection.name}
              count={save.narrowingCount}
              isSaving={save.isPending}
              onConfirm={save.confirmNarrowing}
              onCancel={save.cancelNarrowing}
            />
          </>
        ) : null}
      </HStack>
    </>
  );
}

/** Offers only the scopes the reader may manage (ADR-093 §5a). */
function ConnectionScopeField({
  scopes,
  onChange,
  canManageProject,
  canManageOrganization,
  errorText,
}: {
  scopes: ConnectionScope[];
  onChange: (scopes: ConnectionScope[]) => void;
  canManageProject: boolean;
  canManageOrganization: boolean;
  errorText: string | undefined;
}) {
  const { organization, project } = useOrganizationTeamProject();
  return (
    <Field.Root invalid={errorText !== undefined}>
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
      <Field.ErrorText>{errorText}</Field.ErrorText>
    </Field.Root>
  );
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
  errorText: string | undefined;
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
  errorText,
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
      <Field.Root required invalid={errorText !== undefined}>
        <Field.Label>{label}</Field.Label>
        <Input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => onSecretChange(event.target.value)}
          placeholder={isBot ? "xoxb-…" : "https://hooks.slack.com/services/…"}
        />
        <Field.ErrorText>{errorText}</Field.ErrorText>
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
