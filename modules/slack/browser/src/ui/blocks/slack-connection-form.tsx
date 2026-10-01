import { ScopeChipPicker } from "@langwatch/authz-browser-kit";
import { Link } from "@langwatch/browser-host/link";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import {
  Button,
  Field,
  HStack,
  Input,
  RadioCard,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import {
  maskedSecret,
  narrowingConfirmation,
  SLACK_CONNECTION_KINDS,
  SlackAppSetupCallout,
  type SlackConnection,
} from "@langwatch/slack-browser-kit";
import type { SlackConnectionKind, SlackConnectionScopeType } from "@langwatch/slack-contract";
import type { ReactNode } from "react";

import type { useSaveSlackConnection } from "../../behavior/use-save-slack-connection.ts";
import {
  type ConnectionScope,
  useSlackConnectionFormState,
} from "../../behavior/use-slack-connection-form-state.ts";
import { SlackErrorAlert } from "../elements/slack-error-alert.tsx";

type NamedScope = { id: string; name?: string };

interface SlackConnectionFormProps {
  organization: NamedScope | undefined;
  project: NamedScope | undefined;
  connection: SlackConnection | undefined;
  canManageProject: boolean;
  canManageOrganization: boolean;
  save: ReturnType<typeof useSaveSlackConnection>;
  /** The delete control, for a saved connection; the section binds it. */
  deleteControl: ReactNode;
}

/** The kind, name, scope and secret of one connection. The kind is chosen once at create;
 *  the secret is replaced only when a new one is typed. */
export function SlackConnectionForm({
  organization,
  project,
  connection,
  canManageProject,
  canManageOrganization,
  save,
  deleteControl,
}: SlackConnectionFormProps) {
  const form = useSlackConnectionFormState({
    connection,
    projectId: project?.id,
    organizationId: organization?.id,
    canManageProject,
    canManageOrganization,
  });
  const errorText = form.errorTexts(save.fieldRefusal);

  return (
    <VStack align="stretch" gap={5}>
      <KindField kind={form.kind} onChange={form.setKind} isLocked={!!connection} />
      <ConnectionNameField
        name={form.name}
        kind={form.kind}
        onChange={form.setName}
        isInvalid={form.errors.name}
      />
      <Field.Root invalid={errorText.scope !== void 0}>
        <ScopeChipPicker<SlackConnectionScopeType>
          value={form.scopes}
          onChange={(next: ConnectionScope[]) => form.setScopes(next)}
          organizationId={organization?.id}
          organizationName={organization?.name}
          projectId={project?.id}
          projectName={project?.name}
          allowedScopeTypes={["ORGANIZATION", "PROJECT"]}
          singleSelect
          label="Who can use it"
          subjectNoun="connection"
          currentOrganizationId={canManageOrganization ? organization?.id : void 0}
          currentProjectId={canManageProject ? project?.id : void 0}
        />
        <Field.ErrorText>{errorText.scope}</Field.ErrorText>
      </Field.Root>
      <SecretField
        kind={form.kind}
        secretHint={connection?.secretHint}
        secret={form.secret}
        onSecretChange={form.setSecret}
        isReplacing={form.isReplacingSecret}
        onReplacingChange={form.changeReplacing}
        errorText={errorText.secret}
      />
      <SlackErrorAlert error={save.error} fallbackTitle="Couldn't save the Slack connection" />
      <HStack justify="space-between" align="start">
        <Button
          colorPalette="blue"
          disabled={save.isPending}
          loading={save.isPending}
          onClick={() => form.submit().forEach((draft) => save.run(draft))}
        >
          {connection ? "Save" : "Add connection"}
        </Button>
        {connection ? (
          <>
            {deleteControl}
            <NarrowingConfirmDialog
              name={connection.name}
              counts={save.narrowingCounts}
              isSaving={save.isPending}
              onConfirm={save.confirmNarrowing}
              onCancel={save.cancelNarrowing}
            />
          </>
        ) : null}
      </HStack>
    </VStack>
  );
}

/** Asks before an organization connection other projects use is narrowed. */
function NarrowingConfirmDialog({
  name,
  counts,
  isSaving,
  onConfirm,
  onCancel,
}: {
  name: string;
  counts: number[];
  isSaving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmation = narrowingConfirmation({ name, count: counts[0] ?? 0 });
  return (
    <ConfirmDialog
      open={counts.length > 0}
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
  kind: SlackConnectionKind;
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

function KindField({
  kind,
  onChange,
  isLocked,
}: {
  kind: SlackConnectionKind;
  onChange: (kind: SlackConnectionKind) => void;
  isLocked: boolean;
}) {
  if (isLocked) {
    const current = SLACK_CONNECTION_KINDS.find((candidate) => candidate.value === kind);
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
        const next = SLACK_CONNECTION_KINDS.find((candidate) => candidate.value === value);
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
                <RadioCard.ItemDescription>{option.description}</RadioCard.ItemDescription>
              </RadioCard.ItemContent>
              <RadioCard.ItemIndicator />
            </RadioCard.ItemControl>
          </RadioCard.Item>
        ))}
      </VStack>
    </RadioCard.Root>
  );
}

/** A saved secret shows only its last four characters; typing a new one is an explicit
 *  Replace, so leaving the field alone keeps the stored secret. */
function SecretField({
  kind,
  secretHint,
  secret,
  onSecretChange,
  isReplacing,
  onReplacingChange,
  errorText,
}: {
  kind: SlackConnectionKind;
  secretHint: string | undefined;
  secret: string;
  onSecretChange: (secret: string) => void;
  isReplacing: boolean;
  onReplacingChange: (replacing: boolean) => void;
  errorText: string | undefined;
}) {
  const isBot = kind === "BOT";
  const label = isBot ? "Bot User OAuth token" : "Webhook URL";
  if (!isReplacing && secretHint !== void 0) {
    return (
      <Field.Root>
        <Field.Label>{label}</Field.Label>
        <HStack gap={3}>
          <Text fontSize="sm" fontFamily="mono">
            {maskedSecret(secretHint)}
          </Text>
          <Button size="xs" variant="outline" onClick={() => onReplacingChange(true)}>
            Replace
          </Button>
        </HStack>
      </Field.Root>
    );
  }
  return (
    <VStack align="stretch" gap={2}>
      {isBot ? <SlackAppSetupCallout /> : <WebhookHelp />}
      <Field.Root required invalid={errorText !== void 0}>
        <Field.Label>{label}</Field.Label>
        <Input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => onSecretChange(event.target.value)}
          placeholder={isBot ? "xoxb-…" : "https://hooks.slack.com/services/…"}
        />
        <Field.ErrorText>{errorText}</Field.ErrorText>
        {secretHint !== void 0 ? (
          <Field.HelperText>
            Every automation using this connection switches to the new secret when you save.{" "}
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
      Create an incoming webhook for the channel in your Slack app, then paste its URL.{" "}
      <Link href="https://api.slack.com/messaging/webhooks" isExternal>
        How to create one
      </Link>
    </Text>
  );
}
