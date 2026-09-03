import { createLogger } from "@langwatch/observability";
import { Edit3, Languages, Lightbulb } from "lucide-react";
import { PersonalFeatureGateDialog } from "../../../me/personal-feature-gate-dialog";
import { usePersonalFeatureGate } from "../../../me/use-personal-feature-gate";
import { showErrorToast } from "../../../errors";
import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project";
import { isSameAnnotationTarget, useAnnotationDraftStore } from "../../../../../index";
import {
  HoverActionButton,
  HoverActionCluster,
} from "../../../../elements/explorer/trace-drawer/conversation-view/hover-action-cluster";

const logger = createLogger("MessageAnnotateCluster");

/**
 * What a message offers to have said about it, and what a comment left there is
 * about. A turn is a trace, so its two sides are the trace's own input and
 * output.
 */
export interface MessageAnnotateTarget {
  traceId: string;
  anchorPath: "input" | "output";
  /** What this message said, which a correction of it starts from. */
  text?: string | null;
}

/** Flipping one message to English, owned by whoever holds its text. */
export interface MessageTranslation {
  isActive: boolean;
  isLoading: boolean;
  onToggle: () => void;
}

/** The words each action carries, on the message and on the reply. */
const ACTION_COPY = {
  input: {
    cluster: "Message actions",
    translate: "Translate this message to English",
    annotate: "Annotate this message",
    suggest: "Suggest what this message should have been",
  },
  output: {
    cluster: "Reply actions",
    translate: "Translate this reply to English",
    annotate: "Annotate this reply",
    suggest: "Suggest what this reply should have said",
  },
} as const;

/**
 * The actions on one message of a turn, revealed by hovering it.
 *
 * Sits in the message's label row rather than floating over the text: a
 * positioned overlay on a message that can be one line or forty either covers
 * prose or drifts away from it. In flow it stays where the label is, which is
 * the one part of a message whose position is known.
 *
 * Each action asks for the permission its own work needs. Reading a
 * conversation in a language the reviewer does not speak is reading, so
 * Translate is offered to everyone; annotating is not.
 */
export function MessageAnnotateCluster({
  target,
  translation,
}: {
  target: MessageAnnotateTarget;
  /** Offered only on a side that has text to translate. */
  translation?: MessageTranslation;
}) {
  const { hasPermission } = useOrganizationTeamProject();
  // A reader who may not write annotations mounts none of the machinery
  // behind those actions, which a conversation pays for on every message of
  // every turn on screen.
  if (!hasPermission("annotations:manage")) {
    if (!translation) return null;
    return (
      <HoverActionCluster
        label={ACTION_COPY[target.anchorPath].cluster}
        isHeld={isTranslationHeld(translation)}
      >
        <TranslateAction target={target} translation={translation} />
      </HoverActionCluster>
    );
  }
  return <AnnotateActions target={target} translation={translation} />;
}

function AnnotateActions({
  target,
  translation,
}: {
  target: MessageAnnotateTarget;
  translation?: MessageTranslation;
}) {
  const openDraft = useAnnotationDraftStore((s) => s.openDraft);
  const annotationsGate = usePersonalFeatureGate("annotations");
  const copy = ACTION_COPY[target.anchorPath];

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
        // A correction of this message starts from what it said, whichever
        // side of the turn it is on.
        openDraft({ ...anchor, mode, output: target.text });
      })
      .catch((error) => {
        logger.error({ error }, "could not open the annotation composer");
        showErrorToast({
          error,
          fallbackTitle: "Couldn't open the annotation composer",
        });
      });
  };

  return (
    <HoverActionCluster label={copy.cluster} isHeld={isComposing || isTranslationHeld(translation)}>
      {translation && <TranslateAction target={target} translation={translation} />}
      <HoverActionButton
        icon={Edit3}
        label="Annotate"
        tooltip={copy.annotate}
        accessibleName={copy.annotate}
        onActivate={() => start("annotate")}
      />
      <HoverActionButton
        icon={Lightbulb}
        label="Suggest"
        tooltip={copy.suggest}
        accessibleName={copy.suggest}
        onActivate={() => start("suggest")}
      />
      <PersonalFeatureGateDialog state={annotationsGate.dialogState} />
    </HoverActionCluster>
  );
}

/** Flipping this one message to English, and back. */
function TranslateAction({
  target,
  translation,
}: {
  target: MessageAnnotateTarget;
  translation: MessageTranslation;
}) {
  return (
    <HoverActionButton
      icon={Languages}
      label={
        translation.isLoading ? "Translating…" : translation.isActive ? "Original" : "Translate"
      }
      tooltip={
        translation.isActive ? "Show the original text" : ACTION_COPY[target.anchorPath].translate
      }
      isActive={translation.isActive}
      isDisabled={translation.isLoading}
      isPressed={translation.isActive}
      onActivate={translation.onToggle}
    />
  );
}

/**
 * Whether the cluster stays on screen with the pointer elsewhere: the way back
 * to the original text has to remain reachable while a translation is showing,
 * and while one is on its way.
 */
function isTranslationHeld(translation: MessageTranslation | undefined) {
  return !!translation?.isActive || !!translation?.isLoading;
}
