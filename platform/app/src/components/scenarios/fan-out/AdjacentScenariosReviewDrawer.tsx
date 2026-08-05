import {
  Badge,
  Box,
  Button,
  Checkbox,
  HStack,
  Heading,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, MoreVertical, Play, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { Drawer } from "../../ui/drawer";
import { Menu } from "../../ui/menu";
import { toaster } from "../../ui/toaster";
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
    <AdjacentScenariosReviewDrawer {...props} batchId={props.batchId ?? params.batchId} />
  );
}

export function AdjacentScenariosReviewDrawer({ batchId }: Props) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, openDrawer } = useDrawer();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const utils = api.useContext();
  const batchQuery = api.fanOut.getBatch.useQuery(
    { projectId: project?.id ?? "", batchId: batchId ?? "" },
    { enabled: !!project?.id && !!batchId },
  );

  const decide = api.fanOut.decide.useMutation({
    onSuccess: async () => {
      setSelected(new Set());
      await utils.fanOut.getBatch.invalidate();
    },
    onError: (error) => {
      toaster.create({
        title: "Could not save your decision",
        description: error.message,
        type: "error",
      });
    },
  });

  const runBatch = api.fanOut.run.useMutation({
    onSuccess: async () => {
      await utils.fanOut.getBatch.invalidate();
      if (batchId) openDrawer("adjacentScenariosReport", { batchId });
    },
    onError: (error) => {
      toaster.create({
        title: "Could not start the run",
        description: error.message,
        type: "error",
      });
    },
  });

  const variants = batchQuery.data?.variants ?? [];
  const pendingVariants = useMemo(
    () => variants.filter((v) => v.status === "PENDING"),
    [variants],
  );
  const approvedCount = variants.filter((v) => v.status === "APPROVED").length;

  const applyDecision = useCallback(
    (variantIds: string[], decision: "approve" | "reject") => {
      if (!project?.id || !batchId || variantIds.length === 0) return;
      decide.mutate({
        projectId: project.id,
        batchId,
        decisions: variantIds.map((variantId) => ({ variantId, decision })),
      });
    },
    [project?.id, batchId, decide],
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <Drawer.Root open={true} placement="end" size="xl" onOpenChange={closeDrawer}>
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
          {batchQuery.isLoading ? (
            <HStack justify="center" padding={10}>
              <Spinner size="sm" />
              <Text textStyle="sm" color="fg.muted">
                Loading
              </Text>
            </HStack>
          ) : variants.length === 0 ? (
            <Box padding={10}>
              <Text textStyle="sm" color="fg.muted">
                No variants in this batch.
              </Text>
            </Box>
          ) : (
            <VStack align="stretch" gap={0}>
              {variants.map((variant) => (
                <VariantRow
                  key={variant.id}
                  variant={variant}
                  selected={selected.has(variant.id)}
                  onToggle={() => toggle(variant.id)}
                  onApprove={() => applyDecision([variant.id], "approve")}
                  onReject={() => applyDecision([variant.id], "reject")}
                  onEdit={() =>
                    openDrawer("scenarioEditor", {
                      urlParams: { scenarioId: variant.scenarioId },
                    })
                  }
                />
              ))}
            </VStack>
          )}
        </Drawer.Body>

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
                loading={decide.isPending}
                onClick={() => applyDecision([...selected], "approve")}
              >
                <Check size={14} /> Approve selected
              </Button>
              <Button
                size="xs"
                variant="outline"
                colorPalette="red"
                loading={decide.isPending}
                onClick={() => applyDecision([...selected], "reject")}
              >
                <X size={14} /> Reject selected
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </HStack>
          ) : (
            <Text textStyle="sm" color="fg.muted">
              {pendingVariants.length} awaiting review
            </Text>
          )}

          {approvedCount > 0 && (
            <Button
              size="sm"
              colorPalette="orange"
              loading={runBatch.isPending}
              onClick={() => {
                if (!project?.id || !batchId) return;
                runBatch.mutate({ projectId: project.id, batchId });
              }}
            >
              <Play size={14} /> Run {approvedCount} approved
            </Button>
          )}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function VariantRow({
  variant,
  selected,
  onToggle,
  onApprove,
  onReject,
  onEdit,
}: {
  variant: {
    id: string;
    scenarioId: string;
    lens: string;
    rationale: string | null;
    status: string;
  };
  selected: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  const decided = variant.status !== "PENDING";

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
          checked={selected}
          onCheckedChange={onToggle}
          disabled={decided}
          size="sm"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
        </Checkbox.Root>
      </Box>

      <VStack align="start" gap={1} flex={1} minWidth={0}>
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
        {variant.rationale && (
          <Text textStyle="sm" color="fg.muted">
            {variant.rationale}
          </Text>
        )}
      </VStack>

      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Actions for this variant`}
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
