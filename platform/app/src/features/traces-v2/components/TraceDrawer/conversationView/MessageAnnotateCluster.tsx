import { Button, HStack, Icon, Text } from "@chakra-ui/react";
import { createLogger } from "@langwatch/observability";
import { Edit3, Lightbulb } from "lucide-react";
import { PersonalFeatureGateDialog } from "~/components/me/PersonalFeatureGateDialog";
import { usePersonalFeatureGate } from "~/components/me/usePersonalFeatureGate";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  isSameAnnotationTarget,
  useAnnotationDraftStore,
} from "../../../stores/annotationDraftStore";

const logger = createLogger("MessageAnnotateCluster");

/**
 * What a message offers to have said about it, and what a comment left there is
 * about. A turn is a trace, so its two sides are the trace's own input and
 * output.
 */
export interface MessageAnnotateTarget {
  traceId: string;
  anchorPath: "input" | "output";
  /**
   * Whether a comment here can carry the correction it is asking for. Only the
   * reply can: a correction replaces what the model said, and the trace's own
   * input is not something it carries.
   */
  canSuggest: boolean;
  /** What the reply said, which a suggestion starts from. */
  output?: string | null;
}

/**
 * The comment actions on one message of a turn, revealed by hovering it.
 *
 * Sits in the message's label row rather than floating over the text: a
 * positioned overlay on a message that can be one line or forty either covers
 * prose or drifts away from it. In flow it stays where the label is, which is
 * the one part of a message whose position is known.
 *
 * Held on screen while the comment it opened is still being written, so the
 * control the reviewer clicked does not vanish from under them.
 */
export function MessageAnnotateCluster({
  target,
}: {
  target: MessageAnnotateTarget;
}) {
  const { hasPermission } = useOrganizationTeamProject();
  // A reader who may not write annotations mounts none of the machinery
  // behind the actions, which a conversation pays for on every message of
  // every turn on screen.
  if (!hasPermission("annotations:manage")) return null;
  return <AnnotateActions target={target} />;
}

function AnnotateActions({ target }: { target: MessageAnnotateTarget }) {
  const openDraft = useAnnotationDraftStore((s) => s.openDraft);
  const annotationsGate = usePersonalFeatureGate("annotations");

  const anchor = {
    traceId: target.traceId,
    anchorKind: "field" as const,
    anchorId: target.traceId,
    anchorPath: target.anchorPath,
  };
  const isComposing = useAnnotationDraftStore(
    (s) => !!s.draft && isSameAnnotationTarget(s.draft, anchor),
  );

  const start = (mode: "annotate" | "suggest") => {
    void annotationsGate
      .requestEnable()
      .then((allowed) => {
        if (!allowed) return;
        openDraft({ ...anchor, mode, output: target.output });
      })
      .catch((error) => {
        logger.error({ error }, "could not open the annotation composer");
        toaster.create({
          title: "Could not open the annotation composer",
          type: "error",
        });
      });
  };

  return (
    <HStack
      gap={0.5}
      flexShrink={0}
      opacity={isComposing ? 1 : 0}
      _groupHover={{ opacity: 1 }}
      _groupFocusWithin={{ opacity: 1 }}
      transition="opacity 120ms ease"
      // While it is not revealed the cluster still lies over the message and
      // would swallow the click that selects the turn. The rule is scoped to
      // pointers that can hover, because a pointer that cannot has no way to
      // reveal the cluster and would be left unable to reach the actions.
      css={{
        "@media (hover: hover)": {
          pointerEvents: isComposing ? "auto" : "none",
          ".group:hover &, .group:focus-within &": { pointerEvents: "auto" },
        },
      }}
    >
      <MessageActionButton
        icon={Edit3}
        label="Comment"
        tooltip={
          target.anchorPath === "input"
            ? "Comment on this message"
            : "Comment on this reply"
        }
        onStart={() => start("annotate")}
      />
      {target.canSuggest && (
        <MessageActionButton
          icon={Lightbulb}
          label="Suggest"
          tooltip="Suggest what this reply should have said"
          onStart={() => start("suggest")}
        />
      )}
      <PersonalFeatureGateDialog state={annotationsGate.dialogState} />
    </HStack>
  );
}

function MessageActionButton({
  icon,
  label,
  tooltip,
  onStart,
}: {
  icon: typeof Edit3;
  label: string;
  tooltip: string;
  onStart: () => void;
}) {
  return (
    <Tooltip content={tooltip} positioning={{ placement: "top" }}>
      <Button
        size="2xs"
        variant="ghost"
        color="fg.muted"
        gap={1}
        paddingX={1.5}
        height="18px"
        aria-label={tooltip}
        // The message underneath opens the turn when it is clicked, so the
        // gesture stops here and starts the comment instead.
        onClick={(e) => {
          e.stopPropagation();
          onStart();
        }}
      >
        <Icon as={icon} boxSize={3} />
        <Text textStyle="2xs">{label}</Text>
      </Button>
    </Tooltip>
  );
}
