import { Box, Image, Spinner, VStack } from "@chakra-ui/react";
import { Bug, TextCursorInput } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Edit } from "react-feather";
import { AnnotationPopover } from "~/features/traces-v2/components/TraceDrawer/conversationView/AnnotationPopover";
import { shouldShowGenericTranslateError } from "~/features/traces-v2/utils/translationError";
import { useDrawer } from "~/hooks/useDrawer";
import { useTraceDetailsDrawer } from "~/hooks/useTraceDetailsDrawer";
import { stringifyIfObject } from "~/utils/stringifyIfObject";
import { useAnnotationCommentStore } from "../../hooks/useAnnotationCommentStore";
import { useLiteMemberGuard } from "../../hooks/useLiteMemberGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { Trace } from "../../server/tracer/types";
import { api } from "../../utils/api";
import { getExtractedInput } from "../../utils/traceExtraction";
import { toaster } from "../ui/toaster";
import { Tooltip } from "../ui/tooltip";

export const useTranslationState = () => {
  const [translatedTextInput, setTranslatedTextInput] = useState<string | null>(
    null,
  );
  const [translatedTextOutput, setTranslatedTextOutput] = useState<
    string | null
  >(null);
  const [translationActive, setTranslationActive] = useState(false);

  return {
    translatedTextInput,
    setTranslatedTextInput,
    translatedTextOutput,
    setTranslatedTextOutput,
    translationActive,
    setTranslationActive,
  };
};

type ActionButtonProps = {
  tooltipContent: string;
  onClick: () => void;
  children: ReactNode;
};

const ActionButton = ({
  tooltipContent,
  onClick,
  children,
}: ActionButtonProps) => {
  return (
    <Tooltip
      content={tooltipContent}
      showArrow
      positioning={{ placement: "top" }}
    >
      <Box
        role="button"
        aria-label={tooltipContent}
        // A box that says it is a button has to behave like one: reachable by
        // Tab, and fired by the keys a real button fires on.
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        width="38px"
        height="38px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        paddingY={2}
        paddingX={2}
        borderRadius={"50%"}
        border="1px solid"
        borderColor="border"
        backgroundColor="bg.panel"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        cursor="pointer"
      >
        <VStack>{children}</VStack>
      </Box>
    </Tooltip>
  );
};

export const MessageHoverActions = ({
  trace,
  translatedTextInput,
  setTranslatedTextInput,
  setTranslatedTextOutput,
  setTranslationActive,
  translationActive,
}: {
  trace: Trace;
} & ReturnType<typeof useTranslationState>) => {
  const { project } = useOrganizationTeamProject();
  const { isLiteMember } = useLiteMemberGuard();
  const translateAPI = api.translate.translate.useMutation();

  const translate = () => {
    setTranslationActive(!translationActive);

    if (translatedTextInput) return;
    const inputTranslation = translateAPI.mutateAsync({
      projectId: project?.id ?? "",
      textToTranslate: getExtractedInput(trace),
    });

    const outputTranslation = translateAPI.mutateAsync({
      projectId: project?.id ?? "",
      textToTranslate: trace.output?.value ?? "",
    });

    Promise.all([inputTranslation, outputTranslation])
      .then(([inputData, outputData]) => {
        setTranslatedTextInput(inputData.translation);
        setTranslatedTextOutput(outputData.translation);
      })
      .catch((error: unknown) => {
        // Revert the optimistic toggle. The typed-error toasts (missing
        // model / provider disabled / AI call failed) are raised by the
        // global tRPC error handler in utils/api.tsx, so we only fall back
        // to a generic toast when none of those matched — otherwise a
        // non-typed failure (e.g. "Project not found", a DB error) would
        // leave the user with no feedback at all.
        setTranslationActive(false);
        if (shouldShowGenericTranslateError(error)) {
          toaster.create({
            title: "Error translating",
            description:
              "There was an error translating the message, please try again.",
            type: "error",
            meta: { closable: true },
          });
        }
      });
  };

  const { setCommentState } = useAnnotationCommentStore();
  const [isSuggestingCorrection, setIsSuggestingCorrection] = useState(false);

  const { drawerOpen } = useDrawer();
  const { openTraceDetailsDrawer } = useTraceDetailsDrawer();

  return (
    <VStack
      position="absolute"
      top={"50%"}
      right={-5}
      transform="translateY(-50%)"
    >
      {!isLiteMember && (
        <ActionButton
          tooltipContent="View Trace"
          onClick={() => {
            if (!trace) return;
            if (drawerOpen("traceDetails")) {
              openTraceDetailsDrawer({
                traceId: trace.trace_id,
                selectedTab: "traceDetails",
              });
            } else {
              openTraceDetailsDrawer({
                traceId: trace.trace_id,
              });
            }
          }}
        >
          <Bug size={"20px"} />
        </ActionButton>
      )}

      <ActionButton
        tooltipContent="Translate message to English"
        onClick={translate}
      >
        {translateAPI.isPending ? (
          <Spinner size="sm" />
        ) : translationActive ? (
          <Image
            src="/images/translate-active.svg"
            alt="Translate"
            width="20px"
          />
        ) : (
          <Image src="/images/translate.svg" alt="Translate" width="20px" />
        )}
      </ActionButton>

      <ActionButton
        tooltipContent="Annotate"
        onClick={() => {
          setCommentState?.({
            traceId: trace.trace_id,
            action: "new",
            annotationId: undefined,
          });
        }}
      >
        <Edit size={"20px"} />
      </ActionButton>

      <ActionButton
        tooltipContent="Suggest"
        onClick={() => setIsSuggestingCorrection(true)}
      >
        <TextCursorInput size={"20px"} />
      </ActionButton>

      {/* Mounted only while it is open, and anchored to a hidden span beside
          the action column, the same way the trace drawer anchors its own
          correction popover. */}
      {isSuggestingCorrection && (
        <AnnotationPopover
          traceId={trace.trace_id}
          output={stringifyIfObject(trace.output?.value)}
          mode="suggest"
          open={isSuggestingCorrection}
          onOpenChange={setIsSuggestingCorrection}
          trigger={
            <Box
              as="span"
              aria-hidden="true"
              display="inline-block"
              width="0"
              height="0"
            />
          }
        />
      )}
    </VStack>
  );
};
