/**
 * "Save as insight" under a settled Langy answer, lent through Langy's answer-action
 * extension point. Opens a short form prefilled from the answer; saving files the insight
 * for the whole project. Draws nothing without the flag or `analytics:manage`.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import {
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import {
  DEFAULT_INSIGHT_VALID_DAYS,
  type FileInsightInput,
  INSIGHT_TONES,
  type InsightTone,
  insightBodySchema,
  insightTitleSchema,
} from "@langwatch/insight-contract";
import type { LangyAnswerActionProps } from "@langwatch/langy-contract";
import { BookmarkPlus, Check } from "lucide-react";
import { useState } from "react";

import { useFileInsight } from "../../behavior/use-insight-actions.ts";
import { useInsightHost } from "../../model/insight-host.ts";
import { TONE_PRESENTATION, titleFromAnswer } from "../../model/insight-presentation.ts";

const VALIDITY_CHOICES = [1, 3, 7, 14, 30] as const;

export function SaveAsInsightAction(props: LangyAnswerActionProps) {
  const host = useInsightHost();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const project = host.project();
  if (host.isEnabled() !== true || !host.hasPermission("analytics:manage")) return null;
  if (project?.id !== props.projectId) return null;

  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        color="fg.muted"
        disabled={saved}
        onClick={() => setOpen(true)}
        data-testid="save-as-insight"
      >
        {saved ? <Check size={12} aria-hidden /> : <BookmarkPlus size={12} aria-hidden />}
        {saved ? "Saved as insight" : "Save as insight"}
      </Button>
      {open && (
        <SaveAsInsightDialog
          answer={props}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setSaved(true);
            host.succeeded({
              title: "Saved to Insights",
              description: "The whole project sees it in the inbox.",
            });
          }}
        />
      )}
    </>
  );
}

/** What the answer was about, as the filing keeps it: the pointer, the query and its window. */
function filedSubject(
  subject: LangyAnswerActionProps["subject"],
): Pick<FileInsightInput, "board" | "lwql" | "replay"> {
  const { board, evidence } = subject ?? {};
  return {
    ...(board ? { board: { id: board.id, name: board.name, widget: board.widget ?? null } } : {}),
    ...(evidence
      ? {
          lwql: evidence.lwql,
          replay: {
            ...evidence.window,
            period: evidence.period ?? null,
            parameters: { ...evidence.parameters },
          },
        }
      : {}),
  };
}

function SaveAsInsightDialog({
  answer,
  onClose,
  onSaved,
}: {
  answer: LangyAnswerActionProps;
  onClose: () => void;
  onSaved: () => void;
}) {
  const host = useInsightHost();
  const { file, isPending } = useFileInsight({ projectId: answer.projectId });
  const [title, setTitle] = useState(() => titleFromAnswer(answer.answerText));
  const [body, setBody] = useState(answer.answerText);
  const [tone, setTone] = useState<InsightTone>("watch");
  const [topic, setTopic] = useState("");
  const [validDays, setValidDays] = useState<number>(DEFAULT_INSIGHT_VALID_DAYS);
  const isValid = insightTitleSchema.validate(title) && insightBodySchema.validate(body);

  const save = () => {
    if (!isValid) return;
    file(
      {
        title: title.trim(),
        body: body.trim(),
        tone,
        validDays,
        ...(topic.trim() ? { topic: topic.trim() } : {}),
        ...(answer.conversationId
          ? { source: { conversationId: answer.conversationId, messageId: answer.messageId } }
          : {}),
        ...filedSubject(answer.subject),
      },
      {
        onSuccess: onSaved,
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't save this insight" }),
      },
    );
  };

  return (
    <Dialog.Root open size="md" onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Save as insight</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={4}>
            <Field.Root required>
              <Field.Label>Headline</Field.Label>
              <Input
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="The reader decides in one sentence whether to care"
              />
            </Field.Root>
            <HStack gap={3} align="flex-start">
              <Field.Root>
                <Field.Label>Verdict</Field.Label>
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value={tone}
                    onChange={(event) =>
                      setTone(
                        INSIGHT_TONES.find((value) => value === event.target.value) ?? "watch",
                      )
                    }
                  >
                    {INSIGHT_TONES.map((value) => (
                      <option key={value} value={value}>
                        {TONE_PRESENTATION[value].label}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root>
                <Field.Label>Topic</Field.Label>
                <Input
                  size="sm"
                  value={topic}
                  maxLength={40}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Optional, one word"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Stays true for</Field.Label>
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value={String(validDays)}
                    onChange={(event) => setValidDays(Number(event.target.value))}
                  >
                    {VALIDITY_CHOICES.map((days) => (
                      <option key={days} value={days}>
                        {days === 1 ? "1 day" : `${days} days`}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
            </HStack>
            <Field.Root required>
              <Field.Label>Insight</Field.Label>
              <Textarea value={body} rows={9} onChange={(event) => setBody(event.target.value)} />
              <Field.HelperText>
                What happened, what was checked, what to do. Past its validity it drops to Stale.
              </Field.HelperText>
            </Field.Root>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack width="full">
            <Spacer />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button colorPalette="accent" onClick={save} disabled={!isValid} loading={isPending}>
              Save to Insights
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
