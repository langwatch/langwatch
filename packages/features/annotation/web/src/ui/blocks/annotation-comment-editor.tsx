import {
  Box,
  Button,
  Card,
  Fieldset,
  HStack,
  Input,
  Separator,
  Skeleton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Checkbox, CheckboxGroup } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Popover } from "@langwatch/design-system/popover";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { ChevronDown, MoreVertical, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";

export type AnnotationCommentScore = {
  id: string;
  name: string;
  options: unknown;
  description: string | null;
  dataType: string | null;
  defaultValue: unknown;
};

export type AnnotationCommentScoreOptions = Record<
  string,
  { value: string | string[]; reason: string }
>;

export type AnnotationCommentEditorProps = {
  loading: boolean;
  loadingActor: ReactNode;
  actor: ReactNode;
  mode: "new" | "edit";
  commentInput: ReactNode;
  scores: AnnotationCommentScore[];
  scoreOptions: AnnotationCommentScoreOptions;
  onScoreValueChange: (scoreTypeId: string, value: string | string[]) => void;
  onScoreReasonChange: (scoreTypeId: string, reason: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  deleting: boolean;
  saving: boolean;
  scoringDisabled: ReactNode;
};

let keepDeleteMenuOpen = false;

const annotationScoreOptionsSchema = z.array(
  z.object({ label: z.string(), value: z.union([z.string(), z.number()]) }),
);
const annotationScoreDefaultValueSchema = z.object({
  value: z.string(),
  options: z.array(z.string()),
});

/**
 * Controlled comment editor. App code supplies the authenticated actor, form
 * registration, mutations and transport feedback while this package owns the
 * comment and score picker behaviour.
 */
export function AnnotationCommentEditor({
  loading,
  loadingActor,
  actor,
  mode,
  commentInput,
  scores,
  scoreOptions,
  onScoreValueChange,
  onScoreReasonChange,
  onCancel,
  onDelete,
  deleting,
  saving,
  scoringDisabled,
}: AnnotationCommentEditorProps) {
  const [reasonScoreTypeId, setReasonScoreTypeId] = useState<string | null>(null);
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);

  useEffect(() => {
    keepDeleteMenuOpen = false;
  }, [deleteMenuOpen]);

  if (loading) {
    return <AnnotationCommentEditorSkeleton actor={loadingActor} />;
  }

  const selectedReason = reasonScoreTypeId ? (scoreOptions[reasonScoreTypeId]?.reason ?? "") : "";

  return (
    <>
      <VStack align="start" gap={3}>
        <HStack width="full">
          {actor}
          <Spacer />
          {mode === "edit" && (
            <Menu.Root
              open={deleteMenuOpen}
              onOpenChange={(event) => setDeleteMenuOpen(keepDeleteMenuOpen ? true : event.open)}
            >
              <Menu.Trigger asChild>
                <Button size="xs" variant="ghost" aria-label="Annotation actions">
                  <MoreVertical size={16} />
                </Button>
              </Menu.Trigger>
              <Menu.Content portalled={false}>
                <Menu.Item
                  value="delete"
                  color="red.fg"
                  onClick={() => {
                    keepDeleteMenuOpen = true;
                    onDelete();
                  }}
                >
                  {deleting ? <Spinner size="sm" /> : <Trash2 size={16} />}
                  Delete
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          )}
        </HStack>
        {commentInput}

        <HStack gap={2} width="full" wrap="wrap">
          {scores.map((scoreType) => (
            <AnnotationCommentScoreBlock
              key={scoreType.id}
              scoreType={scoreType}
              value={scoreOptions[scoreType.id]?.value}
              reason={scoreOptions[scoreType.id]?.reason ?? ""}
              onValueChange={(value) => onScoreValueChange(scoreType.id, value)}
              onReasonClick={() => setReasonScoreTypeId(scoreType.id)}
            />
          ))}
        </HStack>

        <HStack width="full">
          <Spacer />
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            type="submit"
            minWidth="fit-content"
            size="sm"
            loading={saving}
          >
            {mode === "new" ? "Save" : "Update"}
          </Button>
        </HStack>

        {scores.length === 0 && scoringDisabled}
      </VStack>

      <AnnotationScoreReasonDialog
        reason={selectedReason}
        open={reasonScoreTypeId !== null}
        onClose={() => setReasonScoreTypeId(null)}
        onConfirm={(reason) => {
          if (reasonScoreTypeId) {
            onScoreReasonChange(reasonScoreTypeId, reason);
          }
          setReasonScoreTypeId(null);
        }}
      />
    </>
  );
}

function AnnotationCommentEditorSkeleton({ actor }: { actor: ReactNode }) {
  return (
    <VStack align="start" gap={3} width="full">
      <HStack>
        <Skeleton>{actor}</Skeleton>
        <Skeleton height="20px" width="120px" />
      </HStack>
      <Skeleton height="40px" width="full" />
      <HStack gap={2} width="full">
        <Skeleton height="24px" width="100px" />
        <Skeleton height="24px" width="100px" />
        <Skeleton height="24px" width="100px" />
      </HStack>
      <HStack width="full" justify="flex-end">
        <Skeleton height="32px" width="80px" />
        <Skeleton height="32px" width="80px" />
      </HStack>
    </VStack>
  );
}

function AnnotationCommentScoreBlock({
  scoreType,
  value,
  reason,
  onValueChange,
  onReasonClick,
}: {
  scoreType: AnnotationCommentScore;
  value: string | string[] | undefined;
  reason: string;
  onValueChange: (value: string | string[]) => void;
  onReasonClick: () => void;
}) {
  const [temporaryValue, setTemporaryValue] = useState<string | string[]>();
  const [open, setOpen] = useState(false);
  const parsedOptions = annotationScoreOptionsSchema.safeParse(scoreType.options);
  const options = parsedOptions.success ? parsedOptions.data : [];
  const parsedDefaultValue = annotationScoreDefaultValueSchema.safeParse(scoreType.defaultValue);
  const defaultRadioValue = parsedDefaultValue.success ? parsedDefaultValue.data.value : "";

  useEffect(() => {
    if (value) setTemporaryValue(value);
  }, [value]);

  return (
    <Popover.Root open={open} onOpenChange={(event) => setOpen(event.open)}>
      <Popover.Trigger asChild>
        <Button size="xs" variant="outline">
          {value ? (Array.isArray(value) ? value.join(", ") : value.toString()) : scoreType.name}
          <ChevronDown size={16} />
        </Button>
      </Popover.Trigger>
      <Popover.Content>
        <Popover.Arrow />
        <Popover.CloseTrigger />
        <Popover.Header>{scoreType.description}</Popover.Header>
        <Popover.Body>
          {scoreType.dataType === "CHECKBOX" ? (
            <Fieldset.Root>
              <CheckboxGroup
                value={temporaryValue ? [temporaryValue].flat() : []}
                onValueChange={setTemporaryValue}
              >
                <VStack align="start" gap={2}>
                  {options.map((option, index) => (
                    <Checkbox value={option.value.toString()} key={index}>
                      {option.label}
                    </Checkbox>
                  ))}
                  <AnnotationScoreButtons
                    reason={reason}
                    temporaryValue={temporaryValue ?? ""}
                    onClear={() => {
                      onValueChange("");
                      setTemporaryValue("");
                    }}
                    onApply={() => {
                      onReasonClick();
                      onValueChange(temporaryValue ?? "");
                      setOpen(false);
                    }}
                  />
                </VStack>
              </CheckboxGroup>
            </Fieldset.Root>
          ) : (
            <Fieldset.Root>
              <RadioGroup
                value={temporaryValue?.toString() ?? ""}
                defaultValue={defaultRadioValue}
                onValueChange={(change) => setTemporaryValue(change.value ?? "")}
              >
                <VStack align="start" gap={2}>
                  {options.map((option) => (
                    <Radio value={option.value.toString()} key={option.value}>
                      {option.label}
                    </Radio>
                  ))}
                  <AnnotationScoreButtons
                    reason={reason}
                    temporaryValue={temporaryValue ?? ""}
                    onClear={() => {
                      onValueChange("");
                      setTemporaryValue("");
                    }}
                    onApply={() => {
                      onReasonClick();
                      onValueChange(temporaryValue ?? "");
                      setOpen(false);
                    }}
                  />
                </VStack>
              </RadioGroup>
            </Fieldset.Root>
          )}
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

function AnnotationScoreButtons({
  reason,
  temporaryValue,
  onClear,
  onApply,
}: {
  reason: string;
  temporaryValue: string | string[];
  onClear: () => void;
  onApply: () => void;
}) {
  return (
    <>
      <Text fontSize="sm">{reason && `Reason: ${reason}`}</Text>
      <HStack width="full">
        <Spacer />
        <Button size="xs" onClick={onClear} variant="outline">
          Clear
        </Button>
        <Button size="xs" onClick={onApply} colorPalette="blue" disabled={!temporaryValue}>
          Apply
        </Button>
      </HStack>
    </>
  );
}

function AnnotationScoreReasonDialog({
  reason: initialReason,
  open,
  onClose,
  onConfirm,
}: {
  reason: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(initialReason);

  useEffect(() => {
    setReason(initialReason);
  }, [initialReason, open]);

  return (
    <Dialog.Root open={open} onOpenChange={onClose} placement="center">
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Why did you select this option?
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Input
            placeholder="Explain your reasoning"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Dialog.Body>
        <Dialog.Footer fontWeight="500">
          <Button variant="outline" mr={3} onClick={onClose}>
            Leave Blank
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => {
              onConfirm(reason);
              onClose();
            }}
          >
            Add
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function AnnotationCommentCard({ children }: { children: ReactNode }) {
  return (
    <Box width="full" minWidth={380}>
      <Card.Root>
        <Card.Body>{children}</Card.Body>
      </Card.Root>
    </Box>
  );
}

export function AnnotationScoringDisabled({ children }: { children: ReactNode }) {
  return (
    <>
      <Separator />
      <Text>
        Scoring metrics are currently disabled. Enable them to add more data to your annotations.
      </Text>
      {children}
    </>
  );
}
