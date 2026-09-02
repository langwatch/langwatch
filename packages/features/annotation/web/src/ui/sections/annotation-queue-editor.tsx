/**
 * Creating an annotation queue, and editing the one that exists.
 *
 * A NARROWED FAMILY-LOCAL COPY of
 * `platform/app/src/components/AddAnnotationQueueDrawer`. The platform drawer
 * stays where it is: it is registered as `addAnnotationQueue` and the send
 * dialog on the trace surfaces still opens it, which deletes-only forbids
 * repointing.
 *
 * ADDRESSED BY THIS FAMILY'S OWN QUERY KEY (`?queue-editor=<id|new>`) rather
 * than through the application's drawer registry. That is the gateway family's
 * shape: the registry is composition, and a screen only ever needed the
 * address — so a link that opens a queue for editing keeps working without this
 * package carrying a copy of the registry, and without the chrome gap the
 * registry's own drawers sit behind.
 *
 * THREE THINGS THE NARROWING TOOK OUT, all recorded rather than slipped away:
 *
 * 1. **The nested "Add New" score type sub-drawer is gone.** It opened
 *    `AddOrEditAnnotationScore`, another 219 lines with its own mutations and
 *    its own callers, to define a score type from inside the queue form. Score
 *    types are defined on `/settings/annotation-scores`, which is a page this
 *    family does not own and which has not moved; the picker now says so. The
 *    same shape the automations family recorded when creating a dataset from
 *    inside its drawer went away.
 * 2. **The slug preview under the name field is gone.** The server mints the
 *    slug (`toQueueSlug`), and the preview restated a slugify vocabulary this
 *    package would have had to copy with nothing narrowing it. A preview that
 *    can disagree with what the server will do is worse than no preview.
 * 3. **`react-hook-form` did not travel.** Two text fields and two pickers are
 *    plain state, which is the trade the datasets family made for the same
 *    reason. The server's own field rejections still land on the field that was
 *    rejected — see `fieldProblems` below.
 */

import {
  Button,
  Field,
  HStack,
  Input,
  Popover,
  Spacer,
  Tag,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { annotationApi } from "../../behavior/annotation-api";
import { readHandledError } from "../../model/handled-error";
import { ReviewerAvatar } from "../elements/reviewer-avatar";

/** What the server said about individual fields, if it named any. */
function fieldProblems(error: unknown): Record<string, string> {
  const handled = readHandledError(error);
  const raw = handled?.meta.fieldErrors;
  if (typeof raw !== "object" || raw === null) return {};
  const problems: Record<string, string> = {};
  for (const [field, messages] of Object.entries(raw as Record<string, unknown>)) {
    const first = Array.isArray(messages) ? messages[0] : messages;
    if (typeof first === "string") problems[field] = first;
  }
  return problems;
}

type Picked = { id: string; name: string | null };

export function AnnotationQueueEditor({
  projectId,
  organizationId,
  queueId,
  onClose,
  onSaved,
  onFailed,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
  /** The queue being edited, or undefined when one is being created. */
  queueId: string | undefined;
  onClose: () => void;
  onSaved: (queueName: string) => void;
  onFailed: (error: unknown) => void;
}) {
  const queue = annotationApi.annotation.getQueueBySlugOrId.useQuery(
    { projectId: projectId ?? "", queueId: queueId ?? "" },
    { enabled: !!projectId && !!queueId },
  );
  const scores = annotationApi.annotationScore.getAllActive.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const organization = annotationApi.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [participants, setParticipants] = useState<Picked[]>([]);
  const [scoreTypes, setScoreTypes] = useState<Picked[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [scoreTypesOpen, setScoreTypesOpen] = useState(false);

  // Edit-mode hydration. Creating a queue never resolves a read, so nothing
  // here fires and the form stays the empty one it started as.
  const loaded = queue.data;
  useEffect(() => {
    if (!loaded) return;
    setName(loaded.name);
    setDescription(loaded.description ?? "");
    setParticipants(
      loaded.members.map((member) => ({ id: member.user.id, name: member.user.name })),
    );
    setScoreTypes(
      loaded.AnnotationQueueScores.map((score) => ({
        id: score.annotationScore.id,
        name: score.annotationScore.name,
      })),
    );
  }, [loaded]);

  const utils = annotationApi.useUtils();
  const save = annotationApi.annotation.createOrUpdateQueue.useMutation({
    onSuccess: (saved) => {
      // Everything that lists queues or counts their work: the listing, the
      // queue page itself, the participants picker, the sidebar entries and
      // its badges. A queue nobody can see yet is a queue nobody can use.
      void utils.annotation.getOptimizedAnnotationQueues.invalidate();
      void utils.annotation.getQueueBySlugOrId.invalidate();
      void utils.annotation.getQueues.invalidate();
      void utils.annotation.getQueueItemsCounts.invalidate();
      void utils.annotation.getPendingItemsCount.invalidate();
      void utils.annotation.getAssignedItemsCount.invalidate();
      onSaved(saved.name);
      onClose();
    },
    onError: (error) => {
      const named = fieldProblems(error);
      setProblems(named);
      // A rejection the server pinned to a field is shown on that field; a
      // rejection it did not is the host's to word, from the code.
      if (Object.keys(named).length === 0) onFailed(error);
    },
  });

  const members = useMemo(() => organization.data?.members ?? [], [organization.data?.members]);

  const submit = () => {
    if (!projectId) return;
    setProblem(null);
    setProblems({});
    if (participants.length === 0 || scoreTypes.length === 0) {
      setProblem("Pick at least one participant and one score type.");
      return;
    }
    save.mutate({
      projectId,
      name,
      description,
      userIds: participants.map((participant) => participant.id),
      scoreTypeIds: scoreTypes.map((scoreType) => scoreType.id),
      ...(queueId ? { queueId } : {}),
    });
  };

  const toggle = (list: Picked[], entry: Picked): Picked[] =>
    list.some((picked) => picked.id === entry.id)
      ? list.filter((picked) => picked.id !== entry.id)
      : [...list, entry];

  return (
    <Drawer.Root
      open
      placement="end"
      size="lg"
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger onClick={onClose} />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              {queueId ? "Edit Annotation Queue" : "Create Annotation Queue"}
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <VStack align="start" gap={4}>
              {problem && (
                <Text color="fg.error" fontSize="sm" role="alert">
                  {problem}
                </Text>
              )}

              <Field.Root>
                <Field.Label>Participants</Field.Label>
                <Popover.Root
                  open={participantsOpen}
                  onOpenChange={({ open }) => setParticipantsOpen(open)}
                  positioning={{ placement: "bottom-start" }}
                >
                  <Popover.Trigger asChild>
                    <Button
                      variant="outline"
                      width="full"
                      justifyContent="space-between"
                      fontWeight="normal"
                      color={participants.length === 0 ? "fg.subtle" : "fg"}
                      paddingX={3}
                    >
                      {participants.length === 0 ? (
                        "Add Participants"
                      ) : (
                        <HStack gap={1} flexWrap="wrap" flex={1}>
                          {participants.map((participant) => (
                            <Tag.Root key={participant.id} size="sm">
                              <Tag.Label>{participant.name}</Tag.Label>
                            </Tag.Root>
                          ))}
                        </HStack>
                      )}
                      <ChevronDown size={16} />
                    </Button>
                  </Popover.Trigger>
                  <Popover.Content width="300px">
                    <Popover.Body>
                      <VStack align="start" gap={1}>
                        {members.map((member) => {
                          const isPicked = participants.some(
                            (participant) => participant.id === member.user.id,
                          );
                          return (
                            <Button
                              key={member.user.id}
                              variant="ghost"
                              width="full"
                              justifyContent="flex-start"
                              padding={1}
                              height="auto"
                              fontWeight="normal"
                              aria-pressed={isPicked}
                              onClick={() =>
                                setParticipants((current) =>
                                  toggle(current, {
                                    id: member.user.id,
                                    name: member.user.name,
                                  }),
                                )
                              }
                            >
                              <Check size={16} color={isPicked ? "green" : "transparent"} />
                              <ReviewerAvatar size="2xs" name={member.user.name ?? ""} />
                              <Text fontSize="sm">{member.user.name}</Text>
                            </Button>
                          );
                        })}
                      </VStack>
                    </Popover.Body>
                  </Popover.Content>
                </Popover.Root>
                <Field.HelperText>
                  Select the participants for this annotation queue
                </Field.HelperText>
              </Field.Root>

              <Field.Root invalid={!!problems.name} width="full">
                <Field.Label>Name Annotation Queue</Field.Label>
                <Input value={name} required onChange={(event) => setName(event.target.value)} />
                <Field.ErrorText>{problems.name}</Field.ErrorText>
                <Field.HelperText>
                  Give it a name to identify this annotation queue
                </Field.HelperText>
              </Field.Root>

              <Field.Root invalid={!!problems.description} width="full">
                <Field.Label>Description</Field.Label>
                <Textarea
                  value={description}
                  required
                  onChange={(event) => setDescription(event.target.value)}
                />
                <Field.ErrorText>{problems.description}</Field.ErrorText>
                <Field.HelperText>Provide a description of the annotation</Field.HelperText>
              </Field.Root>

              <Field.Root>
                <Field.Label>Score Type</Field.Label>
                <Popover.Root
                  open={scoreTypesOpen}
                  onOpenChange={({ open }) => setScoreTypesOpen(open)}
                  positioning={{ placement: "bottom-start" }}
                >
                  <Popover.Trigger asChild>
                    <Button
                      variant="outline"
                      width="full"
                      justifyContent="space-between"
                      fontWeight="normal"
                      color={scoreTypes.length === 0 ? "fg.subtle" : "fg"}
                      paddingX={3}
                    >
                      {scoreTypes.length === 0 ? (
                        "Add Score Type"
                      ) : (
                        <HStack gap={1} flexWrap="wrap" flex={1}>
                          {scoreTypes.map((scoreType) => (
                            <Tag.Root key={scoreType.id} size="sm">
                              <Tag.Label>{scoreType.name}</Tag.Label>
                            </Tag.Root>
                          ))}
                        </HStack>
                      )}
                      <ChevronDown size={16} />
                    </Button>
                  </Popover.Trigger>
                  <Popover.Content width="300px">
                    <Popover.Body>
                      <VStack align="start" gap={1} maxHeight="250px" overflowY="auto">
                        {(scores.data ?? []).map((score) => {
                          const isPicked = scoreTypes.some(
                            (scoreType) => scoreType.id === score.id,
                          );
                          return (
                            <Button
                              key={score.id}
                              variant="ghost"
                              width="full"
                              justifyContent="flex-start"
                              padding={1}
                              height="auto"
                              fontWeight="normal"
                              aria-pressed={isPicked}
                              onClick={() =>
                                setScoreTypes((current) =>
                                  toggle(current, { id: score.id, name: score.name }),
                                )
                              }
                            >
                              <Check size={16} color={isPicked ? "green" : "transparent"} />
                              <Text fontSize="sm">{score.name}</Text>
                            </Button>
                          );
                        })}
                        {(scores.data ?? []).length === 0 && (
                          <Text padding={2} fontSize="sm" color="fg.muted">
                            No score types yet. Define one in Settings, under Annotation Scores.
                          </Text>
                        )}
                      </VStack>
                    </Popover.Body>
                  </Popover.Content>
                </Popover.Root>
                <Field.HelperText>Select the score type for this annotation queue</Field.HelperText>
              </Field.Root>

              <HStack width="full">
                <Spacer />
                <Button
                  colorPalette="orange"
                  type="submit"
                  minWidth="fit-content"
                  loading={save.isPending}
                >
                  Save
                </Button>
              </HStack>
            </VStack>
          </form>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
