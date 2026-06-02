import { Badge, Box, Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Mail, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "~/utils/api";
import { VariableInfoIcon } from "~/features/automations/components/VariableInfoIcon";
import {
  CompactEmailPreview,
  FieldHeader,
  LiquidEditor,
} from "~/features/automations/editors/templateAuthoring";
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
} from "~/shared/templating/defaults";
import { filterVariablesForCadence } from "~/shared/templating/exampleContext";
import type {
  ConfigFormProps,
  NotifyClientDef,
  SavedTriggerRow,
  SummaryIdentity,
} from "../../types";
import { EMAIL_RX, type EmailActionParams, type EmailPreview } from "./shared";

/** A "field that defaults to the framework template until the user
 *  edits it" — `usingDefault=true` means the editor renders the default
 *  text; `value` only matters once the user has typed. */
interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

export interface EmailSlice {
  members: string[];
  subject: FieldDraft;
  body: FieldDraft;
}

const EMPTY_FIELD: FieldDraft = { value: "", usingDefault: true };

function initialSlice(): EmailSlice {
  return { members: [], subject: EMPTY_FIELD, body: EMPTY_FIELD };
}

function isComplete(slice: EmailSlice): boolean {
  return slice.members.length > 0;
}

function summary(slice: EmailSlice, identity: SummaryIdentity): string {
  const name = identity.name || "(unnamed)";
  const total = slice.members.length;
  return `${name} → email to ${total} recipient${total === 1 ? "" : "s"}`;
}

function fromTriggerRow(row: SavedTriggerRow): EmailSlice {
  const params = (row.actionParams ?? {}) as Partial<EmailActionParams>;
  return {
    members: Array.isArray(params.members) ? params.members : [],
    subject: {
      value: row.emailSubjectTemplate ?? "",
      usingDefault: row.emailSubjectTemplate == null,
    },
    body: {
      value: row.emailBodyTemplate ?? "",
      usingDefault: row.emailBodyTemplate == null,
    },
  };
}

function toActionParams(slice: EmailSlice): EmailActionParams {
  return { members: slice.members };
}

function testFireTarget(slice: EmailSlice) {
  return { recipients: slice.members, webhook: null };
}

function templatesFromSlice(slice: EmailSlice) {
  return {
    emailSubjectTemplate: slice.subject.usingDefault ? null : slice.subject.value,
    emailBodyTemplate: slice.body.usingDefault ? null : slice.body.value,
    slackTemplate: null,
    slackTemplateType: null,
  };
}

/**
 * Email config form. Team members render as checkboxes (the canonical
 * list); anything that isn't a team email shows below as a chip with an
 * "External" warning badge. A "+ Add email" input accepts arbitrary
 * addresses validated against `EMAIL_RX`.
 */
function EmailConfigForm({
  slice,
  onChange,
  ctx,
}: ConfigFormProps<EmailSlice, EmailPreview>) {
  const teamWithMembers = api.team.getTeamWithMembers.useQuery(
    { slug: ctx.teamSlug ?? "", organizationId: ctx.organizationId ?? "" },
    { enabled: !!ctx.teamSlug && !!ctx.organizationId },
  );
  const memberEmails = useMemo(
    () =>
      (teamWithMembers.data?.members ?? [])
        .map((m) => m.user.email)
        .filter((e): e is string => typeof e === "string"),
    [teamWithMembers.data],
  );
  const memberSet = useMemo(() => new Set(memberEmails), [memberEmails]);
  const externalRecipients = useMemo(
    () => slice.members.filter((e) => !memberSet.has(e)),
    [slice.members, memberSet],
  );

  const [newEmail, setNewEmail] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const toggleMember = (email: string, checked: boolean) => {
    const next = checked
      ? [...slice.members, email]
      : slice.members.filter((m) => m !== email);
    onChange({ ...slice, members: next });
  };

  const addExternal = () => {
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    if (!EMAIL_RX.test(trimmed)) {
      setAddError("That doesn't look like a valid email address.");
      return;
    }
    if (slice.members.includes(trimmed)) {
      setAddError("Already on the recipient list.");
      return;
    }
    onChange({ ...slice, members: [...slice.members, trimmed] });
    setNewEmail("");
    setAddError(null);
  };

  const removeExternal = (email: string) => {
    onChange({ ...slice, members: slice.members.filter((m) => m !== email) });
  };

  const subjectValue = slice.subject.usingDefault
    ? DEFAULT_EMAIL_SUBJECT_TEMPLATE
    : slice.subject.value;
  const bodyValue = slice.body.usingDefault
    ? DEFAULT_EMAIL_BODY_TEMPLATE
    : slice.body.value;

  const emailPreview = ctx.preview;
  // Immediate is the only live cadence — filter variables so authors only see
  // what's actually populated for the dispatch path they're configuring.
  const variables = useMemo(
    () => filterVariablesForCadence(ctx.variables, "immediate"),
    [ctx.variables],
  );

  return (
    <VStack align="stretch" gap={4}>
      <Field.Root>
        <Field.Label>Recipients</Field.Label>
        <VStack align="stretch" gap={1}>
          {memberEmails.length === 0 ? (
            <Text color="fg.muted" textStyle="sm">
              No team members found.
            </Text>
          ) : (
            memberEmails.map((email) => (
              <HStack key={email} as="label" cursor="pointer">
                <input
                  type="checkbox"
                  checked={slice.members.includes(email)}
                  onChange={(e) => toggleMember(email, e.target.checked)}
                  aria-label={`Send to ${email}`}
                />
                <Text>{email}</Text>
              </HStack>
            ))
          )}
        </VStack>
      </Field.Root>

      <Box>
        <Text textStyle="xs" fontWeight="semibold" color="fg.muted" mb={2}>
          External recipients
        </Text>
        {externalRecipients.length === 0 ? (
          <Text textStyle="sm" color="fg.muted" mb={2}>
            None yet.
          </Text>
        ) : (
          <VStack align="stretch" gap={1} mb={2}>
            {externalRecipients.map((email) => (
              <HStack key={email}>
                <Text flex="1" minWidth="0">
                  {email}
                </Text>
                <Badge size="sm" colorPalette="orange" title="This address is outside your team. The trigger payload — trace input, output, metadata — will leave your org.">
                  External
                </Badge>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => removeExternal(email)}
                  aria-label={`Remove ${email}`}
                >
                  <X size={14} />
                </Button>
              </HStack>
            ))}
          </VStack>
        )}
        <HStack>
          <Input
            value={newEmail}
            placeholder="alerts@partner.com"
            onChange={(e) => {
              setNewEmail(e.target.value);
              setAddError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExternal();
              }
            }}
          />
          <Button variant="outline" onClick={addExternal} disabled={!newEmail.trim()}>
            Add email
          </Button>
        </HStack>
        {addError ? (
          <Text textStyle="xs" color="red.500" mt={1}>
            {addError}
          </Text>
        ) : null}
      </Box>

      <FieldHeader
        label="Subject"
        usingDefault={slice.subject.usingDefault}
        onReset={() => onChange({ ...slice, subject: EMPTY_FIELD })}
        trailing={<VariableInfoIcon variables={variables} />}
      />
      <LiquidEditor
        variables={variables}
        height="56px"
        value={subjectValue}
        onChange={(value) =>
          onChange({ ...slice, subject: { value, usingDefault: false } })
        }
      />
      <FieldHeader
        label="Body (Markdown + Liquid)"
        usingDefault={slice.body.usingDefault}
        onReset={() => onChange({ ...slice, body: EMPTY_FIELD })}
        trailing={<VariableInfoIcon variables={variables} />}
      />
      <LiquidEditor
        variables={variables}
        height="280px"
        value={bodyValue}
        onChange={(value) =>
          onChange({ ...slice, body: { value, usingDefault: false } })
        }
      />

      {emailPreview ? (
        <CompactEmailPreview
          subject={emailPreview.subject}
          html={emailPreview.html}
        />
      ) : null}
    </VStack>
  );
}

const client: NotifyClientDef<EmailSlice, EmailPreview> = {
  Icon: Mail,
  channel: "email",
  initialSlice,
  isComplete,
  summary,
  fromTriggerRow,
  toActionParams,
  testFireTarget,
  templatesFromSlice,
  ConfigForm: EmailConfigForm,
};

export default client;
