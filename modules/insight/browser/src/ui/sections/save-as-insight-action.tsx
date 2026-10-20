/**
 * "Save as insight" under a settled Langy answer, lent through Langy's answer-action extension
 * point. Opens a short form prefilled from the answer, or from one finding of its insights card.
 * Saving files it for the person who saved it. Draws nothing without the flag or `analytics:view`.
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
  ACTIONABLE_INSIGHT_TONES,
  insightBodySchema,
  insightTitleSchema,
} from "@langwatch/insight-contract";
import type { LangyAnswerActionProps } from "@langwatch/langy-contract";
import { BookmarkPlus, Check } from "lucide-react";
import { useState } from "react";

import { useFileInsight } from "../../behavior/use-insight-actions.ts";
import {
  draftOfAnswer,
  draftOfFinding,
  filedFinding,
  filedSubject,
} from "../../model/insight-filing.ts";
import { useInsightHost } from "../../model/insight-host.ts";
import { TONE_PRESENTATION } from "../../model/insight-presentation.ts";

const VALIDITY_CHOICES = [1, 3, 7, 14, 30] as const;

export function SaveAsInsightAction(props: LangyAnswerActionProps) {
  const host = useInsightHost();
  const [open, setOpen] = useState(false);
  /** The findings of the answer's card already saved, by position; `0` for an answer with none. */
  const [saved, setSaved] = useState<readonly number[]>([]);
  const project = host.project();
  if (host.isEnabled() !== true || !host.hasPermission("analytics:view")) return null;
  if (project?.id !== props.projectId) return null;
  const isAllSaved = saved.length >= Math.max(props.insights?.findings.length ?? 0, 1);

  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        color="fg.muted"
        disabled={isAllSaved}
        onClick={() => setOpen(true)}
        data-testid="save-as-insight"
      >
        {isAllSaved ? <Check size={12} aria-hidden /> : <BookmarkPlus size={12} aria-hidden />}
        {isAllSaved ? "Saved as insight" : "Save as insight"}
      </Button>
      {open && (
        <SaveAsInsightDialog
          answer={props}
          saved={saved}
          onClose={() => setOpen(false)}
          onSaved={(position) => {
            setOpen(false);
            setSaved((current) => [...current, position]);
            host.succeeded({
              title: "Saved to Insights",
              description: "Only you see it, in your inbox.",
            });
          }}
        />
      )}
    </>
  );
}

function SaveAsInsightDialog({
  answer,
  saved,
  onClose,
  onSaved,
}: {
  answer: LangyAnswerActionProps;
  saved: readonly number[];
  onClose: () => void;
  onSaved: (position: number) => void;
}) {
  const host = useInsightHost();
  const { file, isPending } = useFileInsight({ projectId: answer.projectId });
  const card = answer.insights;
  const findings = card?.findings ?? [];
  const firstUnsaved = Math.max(
    findings.findIndex((_, position) => !saved.includes(position)),
    0,
  );
  const [position, setPosition] = useState(firstUnsaved);
  const finding = findings[position];
  const [draft, setDraft] = useState(() =>
    finding ? draftOfFinding(finding) : draftOfAnswer(answer.answerText),
  );
  const { title, body, tone, topic, validDays } = draft;
  const validityChoices = [...new Set([...VALIDITY_CHOICES, validDays])].toSorted((a, b) => a - b);
  const isValid = insightTitleSchema.validate(title) && insightBodySchema.validate(body);

  /** Another finding of the card: the form starts again from that finding's own words. */
  const pick = (next: number) => {
    const picked = findings[next];
    if (!picked) return;
    setPosition(next);
    setDraft(draftOfFinding(picked));
  };

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
        // A card's finding is typed data: nothing about it is read back out of the prose.
        ...(card && finding ? filedFinding({ card, finding }) : filedSubject(answer.subject)),
      },
      {
        onSuccess: () => onSaved(position),
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
            {findings.length > 1 && (
              <Field.Root>
                <Field.Label>Finding</Field.Label>
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value={String(position)}
                    onChange={(event) => pick(Number(event.target.value))}
                  >
                    {findings.map((candidate, at) => (
                      <option key={at} value={at} disabled={saved.includes(at)}>
                        {saved.includes(at) ? `${candidate.title} (saved)` : candidate.title}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
            )}
            <Field.Root required>
              <Field.Label>Headline</Field.Label>
              <Input
                value={title}
                maxLength={200}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
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
                      setDraft({
                        ...draft,
                        tone:
                          ACTIONABLE_INSIGHT_TONES.find((value) => value === event.target.value) ??
                          "watch",
                      })
                    }
                  >
                    {ACTIONABLE_INSIGHT_TONES.map((value) => (
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
                  onChange={(event) => setDraft({ ...draft, topic: event.target.value })}
                  placeholder="Optional, one word"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Stays true for</Field.Label>
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value={String(validDays)}
                    onChange={(event) =>
                      setDraft({ ...draft, validDays: Number(event.target.value) })
                    }
                  >
                    {validityChoices.map((days) => (
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
              <Textarea
                value={body}
                rows={9}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              />
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
