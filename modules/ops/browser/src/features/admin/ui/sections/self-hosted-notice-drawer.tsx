import { Drawer } from "@langwatch/design-system/drawer";
import { Field, Input, NativeSelect, Textarea, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useSelfHostedNoticeCommands } from "../../behavior/use-self-hosted-notice-commands.ts";
import {
  draftOfNotice,
  emptyNoticeDraft,
  noticeProblemsOf,
  SELF_HOSTED_NOTICE_SEVERITIES,
  SEVERITY_LABELS,
  type NoticeDraft,
  type NoticeProblems,
  type SelfHostedNoticeRow,
} from "../../model/self-hosted-notice.ts";
import { dateInputToISO } from "../elements/admin-cells.tsx";

/** The controls a failed submit can land on; wrappers that carry the state are skipped. */
const INVALID_CONTROL =
  'input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"]';

/** Writes a new notice as a draft, or edits one; publishing is its own step on the list. */
export function SelfHostedNoticeDrawer({
  open,
  notice,
  onClose,
}: {
  open: boolean;
  /** The notice being edited; null writes a new one. */
  notice: SelfHostedNoticeRow | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<NoticeDraft>(emptyNoticeDraft);
  const [attempts, setAttempts] = useState(0);
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const commands = useSelfHostedNoticeCommands();
  const saving = commands.create.isPending || commands.update.isPending;

  useEffect(() => {
    if (!open) return;
    setDraft(notice ? draftOfNotice(notice) : emptyNoticeDraft());
    setAttempts(0);
  }, [open, notice]);

  useEffect(() => {
    if (attempts === 0) return;
    formRef.current?.querySelector<HTMLElement>(INVALID_CONTROL)?.focus();
  }, [attempts]);

  const expiresAt = draft.expiresOn ? dateInputToISO(draft.expiresOn) : null;
  const problems: NoticeProblems = attempts > 0 ? noticeProblemsOf(draft, expiresAt) : {};

  const set = <K extends keyof NoticeDraft>(key: K, value: NoticeDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (Object.keys(noticeProblemsOf(draft, expiresAt)).length > 0) {
      setAttempts((count) => count + 1);
      return;
    }
    const fields = {
      severity: draft.severity,
      title: draft.title.trim(),
      body: draft.body,
      url: draft.url.trim() || null,
      fixedIn: draft.fixedIn.trim() || null,
      expiresAt,
    };
    if (notice) commands.update.mutate({ id: notice.id, ...fields }, { onSuccess: onClose });
    else commands.create.mutate(fields, { onSuccess: onClose });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={notice ? "Edit notice" : "New notice"}
      size="md"
      footer={{
        cancel: { onClick: onClose },
        primaryAction: {
          label: notice ? "Save notice" : "Save as draft",
          type: "submit",
          form: formId,
          loading: saving,
        },
      }}
    >
      <form id={formId} ref={formRef} noValidate onSubmit={submit}>
        <VStack align="start" gap={4} width="full">
          <Field.Root>
            <Field.Label>Severity</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field
                aria-label="Severity"
                value={draft.severity}
                onChange={(event) =>
                  set(
                    "severity",
                    SELF_HOSTED_NOTICE_SEVERITIES.find((each) => each === event.target.value) ??
                      "info",
                  )
                }
              >
                {SELF_HOSTED_NOTICE_SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {SEVERITY_LABELS[severity]}
                  </option>
                ))}
              </NativeSelect.Field>
            </NativeSelect.Root>
          </Field.Root>
          <Field.Root required invalid={problems.title !== undefined}>
            <Field.Label>Title</Field.Label>
            <Input
              aria-invalid={problems.title !== undefined || undefined}
              value={draft.title}
              onChange={(event) => set("title", event.target.value)}
              placeholder="Upgrade to 3.4.2"
            />
            <Field.ErrorText>{problems.title}</Field.ErrorText>
          </Field.Root>
          <Field.Root invalid={problems.body !== undefined}>
            <Field.Label>Message</Field.Label>
            <Textarea
              rows={4}
              aria-invalid={problems.body !== undefined || undefined}
              value={draft.body}
              onChange={(event) => set("body", event.target.value)}
              placeholder="What changed, and what the operator should do about it"
            />
            <Field.HelperText>
              Every self-hosted install receives this, so treat it as public: no exploit details.
            </Field.HelperText>
            <Field.ErrorText>{problems.body}</Field.ErrorText>
          </Field.Root>
          <Field.Root invalid={problems.url !== undefined}>
            <Field.Label>Link</Field.Label>
            <Input
              aria-invalid={problems.url !== undefined || undefined}
              value={draft.url}
              onChange={(event) => set("url", event.target.value)}
              placeholder="https://"
            />
            <Field.HelperText>Where to read more. Optional.</Field.HelperText>
            <Field.ErrorText>{problems.url}</Field.ErrorText>
          </Field.Root>
          <Field.Root invalid={problems.fixedIn !== undefined}>
            <Field.Label>Fixed in</Field.Label>
            <Input
              aria-invalid={problems.fixedIn !== undefined || undefined}
              value={draft.fixedIn}
              onChange={(event) => set("fixedIn", event.target.value)}
              placeholder="3.4.2"
            />
            <Field.HelperText>
              Installs already on this release or newer don&apos;t show the notice. Optional.
            </Field.HelperText>
            <Field.ErrorText>{problems.fixedIn}</Field.ErrorText>
          </Field.Root>
          <Field.Root invalid={problems.expiresOn !== undefined}>
            <Field.Label>Stops showing on</Field.Label>
            <Input
              type="date"
              aria-invalid={problems.expiresOn !== undefined || undefined}
              value={draft.expiresOn}
              onChange={(event) => set("expiresOn", event.target.value)}
            />
            <Field.HelperText>Leave empty to show it until it is withdrawn.</Field.HelperText>
            <Field.ErrorText>{problems.expiresOn}</Field.ErrorText>
          </Field.Root>
        </VStack>
      </form>
    </Drawer>
  );
}
