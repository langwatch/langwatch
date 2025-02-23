import { Box, Image, Spinner, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { Trace } from "../../server/tracer/types";
import { api } from "../../utils/api";

import { Edit } from "react-feather";
import { getExtractedInput } from "../../components/messages/MessageCard";

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

  return (
    <VStack
      position="absolute"
      top={"50%"}
      right={-5}
      transform="translateY(-50%)"
    >
      <Tooltip
        content="Translate message to English"
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
            translate();
          }}
          cursor="pointer"
        >
          <VStack>
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
          </VStack>
        </Box>
      </Tooltip>
      <Tooltip content="Annotate" showArrow positioning={{ placement: "top" }}>
        <Box
          width="38px"
          height="38px"
          display="flex"
          alignItems="center"
          justifyContent="center"
          paddingY={2}
          paddingX={2}
          borderRadius={"3xl"}
          border="1px solid"
          borderColor="gray.200"
          backgroundColor="white"
          onClick={(e) => {
            e.stopPropagation();

            setCommentState?.({
              traceId: trace.trace_id,
              action: "new",
              annotationId: undefined,
            });
          }}
          cursor="pointer"
        >
          <VStack>
            <Edit size={"20px"} />
          </VStack>
        </Box>
      </Tooltip>
    </VStack>
  );
};
