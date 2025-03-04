import { Box, Image, Spinner, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { Trace } from "../../server/tracer/types";
import { api } from "../../utils/api";

import { Edit, Italic, Search } from "react-feather";
import { getExtractedInput } from "../../components/messages/MessageCard";

import { useDrawer } from "../../components/CurrentDrawer";
import { useAnnotationCommentStore } from "../../hooks/useAnnotationCommentStore";

import { toaster } from "../ui/toaster";
import { Tooltip } from "../ui/tooltip";

export const useTranslationState = () => {
  const [translatedTextInput, setTranslatedTextInput] = useState<string | null>(
    null
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
  onClick: (e: React.MouseEvent) => void;
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
        width="38px"
        height="38px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        paddingY={2}
        paddingX={2}
        borderRadius={"50%"}
        border="1px solid"
        borderColor="gray.200"
        backgroundColor="white"
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
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
      .catch(() => {
        toaster.create({
          title: "Error translating",
          description:
            "There was an error translating the message, please try again.",
          type: "error",
          meta: {
            closable: true,
          },
          placement: "top-end",
        });
      });
  };

  const { setCommentState } = useAnnotationCommentStore();

  const { openDrawer, drawerOpen } = useDrawer();

  return (
    <VStack
      position="absolute"
      top={"50%"}
      right={-5}
      transform="translateY(-50%)"
    >
      <ActionButton
        tooltipContent="Translate message to English"
        onClick={translate}
      >
        {translateAPI.isLoading ? (
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
        tooltipContent="Expected Output"
        onClick={() => {
          setCommentState?.({
            traceId: trace.trace_id,
            action: "new",
            annotationId: undefined,
            expectedOutput: trace.output?.value,
            expectedOutputAction: "new",
          });
        }}
      >
        <Italic size={"20px"} />
      </ActionButton>

      <ActionButton
        tooltipContent="View Trace"
        onClick={() => {
          if (!trace) return;
          if (drawerOpen("traceDetails")) {
            openDrawer(
              "traceDetails",
              {
                traceId: trace.trace_id,
                selectedTab: "traceDetails",
              },
              { replace: true }
            );
          } else {
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            });
          }
        }}
      >
        <Search size={"20px"} />
      </ActionButton>
    </VStack>
  );
};
