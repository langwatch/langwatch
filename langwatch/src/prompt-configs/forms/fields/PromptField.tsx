import {
  Box,
  Field,
  HStack,
  Spacer,
  Text,
  type BoxProps,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFormContext, type UseFieldArrayReturn } from "react-hook-form";
import { Mention, MentionsInput } from "react-mentions";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { VerticalFormControl } from "~/components/VerticalFormControl";
import { PropertySectionTitle } from "../../../optimization_studio/components/properties/BasePropertiesPanel";
import { AddRemoveMessageFieldButton } from "./PromptMessagesField";

export function PromptField({
  templateAdapter,
  messageFields,
  availableFields,
  otherNodesFields,
  onAddEdge,
  isTemplateSupported = true,
}: {
  templateAdapter: "default" | "dspy_chat_adapter";
  messageFields: UseFieldArrayReturn<
    PromptConfigFormValues,
    "version.configData.messages",
    "id"
  >;
  availableFields: string[];
  otherNodesFields: Record<string, string[]>;
  onAddEdge?: (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention
  ) => void;
  isTemplateSupported?: boolean;
}) {
  const form = useFormContext<PromptConfigFormValues>();
  const { formState } = form;
  const { errors } = formState;
  const value = form.watch("version.configData.prompt");

  return (
    <VerticalFormControl
      label={
        <HStack width="full">
          <Field.Label margin={0}>
            <PropertySectionTitle padding={0}>
              System Prompt
            </PropertySectionTitle>
          </Field.Label>
          <Spacer />

          {templateAdapter === "default" &&
            messageFields.fields.length === 0 && (
              <AddRemoveMessageFieldButton messageFields={messageFields} />
            )}
        </HStack>
      }
      invalid={!!errors.version?.configData?.prompt}
      helper={errors.version?.configData?.prompt?.message?.toString()}
      error={errors.version?.configData?.prompt}
      size="sm"
    >
      <PromptTextArea
        value={typeof value === "string" ? value : ""}
        onChange={(event) => {
          if (typeof event.target.value === "string") {
            form.setValue("version.configData.prompt", event.target.value, {
              shouldValidate: true,
            });
          }
        }}
        availableFields={availableFields}
        otherNodesFields={otherNodesFields}
        onAddEdge={onAddEdge}
        isTemplateSupported={isTemplateSupported}
      />
    </VerticalFormControl>
  );
}

export type PromptTextAreaOnAddMention = {
  value: string;
  display: string;
  startPos: number;
  endPos: number;
};

export function PromptTextArea({
  availableFields,
  value,
  onChange,
  placeholder,
  otherNodesFields,
  onAddEdge,
  isTemplateSupported = true,
  ...props
}: {
  availableFields: string[];
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
  placeholder?: string;
  otherNodesFields: Record<string, string[]>;
  onAddEdge?: (
    id: string,
    handle: string,
    content: PromptTextAreaOnAddMention
  ) => void;
  isTemplateSupported?: boolean;
} & Omit<BoxProps, "onChange">) {
  const mentionData = useMemo(
    () => [
      ...availableFields.map((field) => ({
        id: field,
        display: field,
      })),
      ...Object.entries(otherNodesFields).flatMap(([nodeId, fields]) =>
        fields.map((field) => ({
          id: `${nodeId}.${field}`,
          display: `${nodeId}.${field}`,
        }))
      ),
    ],
    [availableFields, otherNodesFields]
  );
  const availableIds = useMemo(
    () => mentionData.map((m) => m.id),
    [mentionData]
  );

  const boxRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasAnyTemplateMarkers = value?.match(/{{.*?}}/g);

  const updateInvalidMentions = useCallback(() => {
    if (!boxRef.current) return;
    const mentions = boxRef.current.querySelectorAll(".mention");
    mentions.forEach((mention) => {
      const id = mention.textContent?.match(/\{\{(.*?)\}\}/)?.[1];
      if (id && !availableIds.includes(id)) {
        mention.classList.add("invalid");
      } else {
        mention.classList.remove("invalid");
      }
    });
  }, [availableIds]);

  useEffect(() => {
    updateInvalidMentions();
  }, [value, availableIds]);

  return (
    <>
      <Box
        ref={boxRef}
        fontFamily="mono"
        fontSize={13}
        css={{
          "& textarea": {
            border: "1px solid #E2E8F0",
            borderRadius: 6,
            padding: "8px 10px",
            backgroundClip: "padding-box",
          },
          "& textarea:focus": {
            borderWidth: "2px",
            borderColor: "blue.500",
            padding: "7px 9px",
          },
          "& .mention": {
            backgroundColor: "blue.50",
            borderRadius: "4px",
            border: "1px solid",
            borderColor: "blue.200",
            marginLeft: "-2px",
            marginRight: "-2px",
            padding: "1px",
          },
          "& .mention.invalid": {
            borderColor: "red.200",
            backgroundColor: "red.50",
          },
        }}
        {...props}
      >
        <MentionsInput
          value={value ?? ""}
          onChange={(event) => {
            onChange && onChange(event);
          }}
          onBlur={() => {
            setTimeout(() => {
              updateInvalidMentions();
            }, 1);
          }}
          onFocus={() => {
            setTimeout(() => {
              updateInvalidMentions();
            }, 1);
          }}
          onKeyUp={() => {
            setTimeout(() => {
              updateInvalidMentions();
            }, 1);
          }}
          onClick={() => {
            setTimeout(() => {
              updateInvalidMentions();
            }, 1);
          }}
          style={{
            control: {
              fontSize: 13,
              minHeight: 80,
              maxHeight: "33vh",
              border: "none",
              background: "transparent",
            },
            suggestions: {
              background: "transparent",
            },
            highlighter: {
              overflow: "hidden",
              padding: "7px 9px",
              maxHeight: "33vh",
            },
            input: {
              minHeight: 80,
              maxHeight: "33vh",
              outline: "none",
              background: "transparent",
              overflow: "auto",
            },
          }}
          inputRef={textareaRef}
          customSuggestionsContainer={(children) => (
            <Box
              background="white"
              border="1px solid #e2e8f0"
              borderRadius={4}
              padding="4px"
              boxShadow="0 2px 8px rgba(0,0,0,0.08)"
              marginLeft="12px"
              marginTop="-4px"
            >
              {children}
            </Box>
          )}
          placeholder={placeholder}
        >
          {["{", "{{"].map((trigger) => (
            <Mention
              key={trigger}
              trigger={trigger}
              markup="{{__id__}}"
              data={mentionData}
              displayTransform={(id: string) => `{{${id}}}`}
              className="mention"
              onAdd={(id, display, startPos, endPos) => {
                if (typeof id === "string" && id.includes(".")) {
                  const [nodeId, field] = id.split(".");
                  if (!nodeId || !field) return;
                  onAddEdge?.(nodeId, field, {
                    value: value ?? "",
                    display,
                    startPos,
                    endPos,
                  });
                }
              }}
              renderSuggestion={(
                _suggestion,
                _search,
                highlightedDisplay,
                _index,
                focused
              ) => (
                <Box
                  background={focused ? "blue.100" : "white"}
                  color={focused ? "blue.800" : "gray.800"}
                  padding="4px 8px"
                  cursor="pointer"
                  borderRadius={2}
                  fontFamily="body"
                >
                  {highlightedDisplay}
                </Box>
              )}
            />
          ))}
        </MentionsInput>
      </Box>
      {hasAnyTemplateMarkers && !isTemplateSupported && (
        <Text fontSize="xs" color="red.800" paddingTop={2}>
          Template {"{{markers}}"} are not supported by DSPy Adapter, instead,
          input variables are included automatically. Please change to default
          template adapter if you want to use them.
        </Text>
      )}
    </>
  );
}
