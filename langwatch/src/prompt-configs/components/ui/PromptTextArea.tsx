import { Box, Text, type BoxProps } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Mention, MentionsInput } from "react-mentions";

export interface PromptTextAreaOnAddMention {
  value: string;
  display: string;
  startPos: number;
  endPos: number;
}

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

  /**
   * The MentionsInput doesn't not handle resizing well,
   * and for some reason, there is no event listener for the resize event
   * on the textarea it provides.
   *
   * This is a hack to force the box to be the same height as the textarea while
   * the user is resizing the textarea.
   */
  useEffect(() => {
    const resizeHandler = () => {
      const textarea = textareaRef.current;
      const box = boxRef.current;
      if (textarea && box) {
        box.style.height = textarea.scrollHeight + "px";
      }
    };

    const resizeObserver = new ResizeObserver(resizeHandler);
    if (textareaRef.current) {
      resizeObserver.observe(textareaRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

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
              resize: "vertical",
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
