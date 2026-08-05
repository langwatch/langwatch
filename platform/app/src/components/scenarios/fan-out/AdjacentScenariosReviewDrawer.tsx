import {
  Badge,
  Box,
  Button,
  Checkbox,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, MoreVertical, Play, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { Drawer } from "../../ui/drawer";
import { Menu } from "../../ui/menu";
import { FAN_OUT_LENS_LABELS } from "../services/fanOutGeneration";

interface Props {
  batchId?: string;
}

/**
 * Review queue for a batch of generated adjacent scenarios.
 *
 * Every variant lands here pending a human decision: nothing reaches the
 * permanent scenario library unread. Approving keeps the variant and makes it
 * eligible to run; rejecting archives the underlying scenario so rejects don't
 * clutter the library.
 *
 * See specs/scenarios/adjacent-scenario-review.feature.
 */
export function AdjacentScenariosReviewDrawerFromUrl(props: Props) {
  const params = useDrawerParams();
  return (
    <AdjacentScenariosReviewDrawer
      {...props}
      batchId={props.batchId ?? params.batchId}
    />
  );
}

/**
 * The review queue's state: what is selected, and the two mutations that act
 * on it. Returns state and callbacks only, never JSX.
 */
function useReviewQueue({
  projectId,
  batchId,
  onDispatched,
}: {
  projectId: string | undefined;
  batchId: string | undefined;
  onDispatched: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const utils = api.useUtils();
  const canQuery = !!projectId && !!batchId;

  const batchQuery = api.fanOut.getBatch.useQuery(
    { projectId: projectId ?? "", batchId: batchId ?? "" },
    { enabled: canQuery },
  );

  const decide = api.fanOut.decide.useMutation({
    onSuccess: async () => {
      setSelected(new Set());
      await utils.fanOut.getBatch.invalidate();
    },
    onError: (error) => {
      showErrorToast({ error, fallbackTitle: "Couldn't save your decision" });
    },
  });

  const runBatch = api.fanOut.run.useMutation({
    onSuccess: async () => {
      await utils.fanOut.getBatch.invalidate();
      onDispatched();
    },
    onError: (error) => {
      showErrorToast({ error, fallbackTitle: "Couldn't start the run" });
    },
  });

  const variants = useMemo(
    () => batchQuery.data?.variants ?? [],
    [batchQuery.data?.variants],
  );

  const applyDecision = useCallback(
    (variantIds: string[], decision: "approve" | "reject") => {
      if (!projectId || !batchId || variantIds.length === 0) return;
      decide.mutate({
        projectId,
        batchId,
        decisions: variantIds.map((variantId) => ({ variantId, decision })),
      });
    },
    [projectId, batchId, decide],
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runApproved = useCallback(() => {
    if (!projectId || !batchId) return;
    runBatch.mutate({ projectId, batchId });
  }, [projectId, batchId, runBatch]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  return {
    batchQuery,
    canQuery,
    variants,
    selected,
    clearSelection,
    toggle,
    applyDecision,
    runApproved,
    deciding: decide.isPending,
    running: runBatch.isPending,
    pendingCount: variants.filter((v) => v.status === "PENDING").length,
    approvedCount: variants.filter((v) => v.status === "APPROVED").length,
  };
}

export function AdjacentScenariosReviewDrawer({ batchId }: Props) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, openDrawer } = useDrawer();

  const queue = useReviewQueue({
    projectId: project?.id,
    batchId,
    onDispatched: () => {
      if (batchId) openDrawer("adjacentScenariosReport", { batchId });
    },
  });

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="xl"
      onOpenChange={closeDrawer}
    >
      <Drawer.Content>
        <Drawer.Header borderBottomWidth="1px">
          <VStack align="start" gap={1}>
            <Heading size="md">Review adjacent scenarios</Heading>
            <Text textStyle="sm" color="fg.muted">
              Each one is a small step away from the failure you started from.
              Keep the ones worth testing.
            </Text>
          </VStack>
          <Drawer.CloseTrigger />
        </Drawer.Header>

        <Drawer.Body padding={0}>
          <ReviewBody
            error={queue.batchQuery.error}
            loading={!queue.canQuery || queue.batchQuery.isLoading}
            variants={queue.variants}
            selected={queue.selected}
            onToggle={queue.toggle}
            onDecide={queue.applyDecision}
            openDrawer={openDrawer}
          />
        </Drawer.Body>

        <ReviewFooter
          selected={queue.selected}
          pendingCount={queue.pendingCount}
          approvedCount={queue.approvedCount}
          deciding={queue.deciding}
          running={queue.running}
          onDecide={queue.applyDecision}
          onClearSelection={queue.clearSelection}
          onRun={queue.runApproved}
        />
      </Drawer.Content>
    </Drawer.Root>
  );
}

function ReviewFooter({
  selected,
  pendingCount,
  approvedCount,
  deciding,
  running,
  onDecide,
  onClearSelection,
  onRun,
}: {
  selected: Set<string>;
  pendingCount: number;
  approvedCount: number;
  deciding: boolean;
  running: boolean;
  onDecide: (ids: string[], decision: "approve" | "reject") => void;
  onClearSelection: () => void;
  onRun: () => void;
}) {
  return (
    <Drawer.Footer borderTopWidth="1px" justifyContent="space-between">
      {/* An inline bar, not the viewport-fixed SelectionActionBar: that one
          sits at zIndex 20, below the drawer overlay, so inside a drawer it
          would render behind the surface (selection-action-bar.md). */}
      {selected.size > 0 ? (
        <HStack gap={2}>
          <Text textStyle="sm" fontWeight="medium">
            {selected.size} selected
          </Text>
          <Box width="1px" height="20px" bg="border.muted" />
          <Button
            size="xs"
            variant="outline"
            loading={deciding}
            onClick={() => onDecide([...selected], "approve")}
          >
            <Check size={14} /> Approve selected
          </Button>
          <Button
            size="xs"
            variant="outline"
            colorPalette="red"
            loading={deciding}
            onClick={() => onDecide([...selected], "reject")}
          >
            <X size={14} /> Reject selected
          </Button>
          <Button size="xs" variant="ghost" onClick={onClearSelection}>
            Clear
          </Button>
        </HStack>
      ) : (
        <Text textStyle="sm" color="fg.muted">
          {pendingCount} awaiting review
        </Text>
      )}

      {approvedCount > 0 && (
        <Button
          size="sm"
          colorPalette="orange"
          loading={running}
          onClick={onRun}
        >
          <Play size={14} /> Run {approvedCount} approved
        </Button>
      )}
    </Drawer.Footer>
  );
}

/** A variant as the review queue renders it: the row plus its scenario. */
type ReviewVariant = {
  id: string;
  scenarioId: string;
  lens: string;
  rationale: string | null;
  status: string;
  scenario: {
    name: string;
    situation: string;
    criteria: string[];
  } | null;
};

/** The one place that decides between error, loading, empty and the queue. */
function ReviewBody({
  error,
  loading,
  variants,
  selected,
  onToggle,
  onDecide,
  openDrawer,
}: {
  error: unknown;
  loading: boolean;
  variants: ReviewVariant[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onDecide: (ids: string[], decision: "approve" | "reject") => void;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
}) {
  if (error) {
    return (
      <Box padding={6}>
        <HandledErrorAlert
          error={error}
          fallbackTitle="Couldn't load these scenarios"
        />
      </Box>
    );
  }

  if (loading) {
    return (
      <HStack justify="center" padding={10}>
        <Spinner size="sm" />
        <Text textStyle="sm" color="fg.muted">
          Loading
        </Text>
      </HStack>
    );
  }

  if (variants.length === 0) {
    return (
      <Box padding={10}>
        <Text textStyle="sm" color="fg.muted">
          No variants in this batch.
        </Text>
      </Box>
    );
  }

  return (
    <VStack align="stretch" gap={0}>
      {variants.map((variant) => (
        <VariantRow
          key={variant.id}
          variant={variant}
          isSelected={selected.has(variant.id)}
          onToggle={() => onToggle(variant.id)}
          onApprove={() => onDecide([variant.id], "approve")}
          onReject={() => onDecide([variant.id], "reject")}
          onEdit={() =>
            openDrawer("scenarioEditor", {
              urlParams: { scenarioId: variant.scenarioId },
            })
          }
        />
      ))}
    </VStack>
  );
}

function VariantRow({
  variant,
  isSelected,
  onToggle,
  onApprove,
  onReject,
  onEdit,
}: {
  variant: ReviewVariant;
  isSelected: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  const isDecided = variant.status !== "PENDING";

  return (
    <HStack
      align="start"
      gap={3}
      paddingX={6}
      paddingY={4}
      borderBottomWidth="1px"
      borderColor="border.muted"
      opacity={variant.status === "REJECTED" ? 0.55 : 1}
    >
      <Box paddingTop={1}>
        <Checkbox.Root
          checked={isSelected}
          onCheckedChange={onToggle}
          disabled={isDecided}
          size="sm"
        >
          <Checkbox.HiddenInput
            aria-label={`Select ${variant.scenario?.name ?? variant.lens}`}
          />
          <Checkbox.Control />
        </Checkbox.Root>
      </Box>

      <VStack align="start" gap={2} flex={1} minWidth={0}>
        <HStack gap={2} flexWrap="wrap">
          <Badge size="sm" variant="subtle">
            {FAN_OUT_LENS_LABELS[variant.lens] ?? variant.lens}
          </Badge>
          {variant.status === "APPROVED" && (
            <Badge size="sm" colorPalette="green" variant="subtle">
              Approved
            </Badge>
          )}
          {variant.status === "REJECTED" && (
            <Badge size="sm" colorPalette="red" variant="subtle">
              Rejected
            </Badge>
          )}
        </HStack>

        {variant.scenario && (
          <Text textStyle="sm" fontWeight="medium">
            {variant.scenario.name}
          </Text>
        )}

        {variant.rationale && (
          <Text textStyle="sm" color="fg.muted">
            {variant.rationale}
          </Text>
        )}

        {variant.scenario && (
          <VStack align="start" gap={1} width="full">
            <Text textStyle="xs" color="fg.muted" whiteSpace="pre-wrap">
              {variant.scenario.situation}
            </Text>
            {variant.scenario.criteria.length > 0 && (
              <VStack align="start" gap={0.5} width="full">
                {variant.scenario.criteria.map((criterion, index) => (
                  <Text
                    key={`${index}-${criterion}`}
                    textStyle="xs"
                    color="fg.muted"
                  >
                    {"•"} {criterion}
                  </Text>
                ))}
              </VStack>
            )}
          </VStack>
        )}
      </VStack>

      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Actions for ${variant.scenario?.name ?? variant.lens}`}
          >
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item
            value="approve"
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
          >
            Approve
          </Menu.Item>
          <Menu.Item
            value="edit"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            Edit
          </Menu.Item>
          <Menu.Item
            value="reject"
            color="red.500"
            onClick={(e) => {
              e.stopPropagation();
              onReject();
            }}
          >
            Reject
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </HStack>
  );
}
