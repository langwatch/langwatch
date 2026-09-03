type MessageParam = {
  identifier: string;
  type: string;
  value: Array<{ role: string; content: string }> | string;
};

type ComputeMessageEdgeUpdateParams = {
  formMessages: Array<{ role: string; content?: string }>;
  nodeParameters: MessageParam[];
  formIndex: number;
  newContent: string;
};

type ComputeMessageEdgeUpdateResult = {
  parameterToUpdate: "instructions" | "messages";
  messagesIndex?: number;
  newValue: string | Array<{ role: string; content: string }>;
};

/** The form includes its system message; DSL messages store it as instructions. */
export const computeMessageEdgeUpdate = ({
  formMessages,
  nodeParameters,
  formIndex,
  newContent,
}: ComputeMessageEdgeUpdateParams): ComputeMessageEdgeUpdateResult => {
  const editedMessage = formMessages[formIndex];
  const isSystemMessage = editedMessage?.role === "system";

  if (isSystemMessage) {
    return {
      parameterToUpdate: "instructions",
      newValue: newContent,
    };
  }

  const systemIndex = formMessages.findIndex((message) => message.role === "system");
  const adjustedIndex = systemIndex >= 0 && formIndex > systemIndex ? formIndex - 1 : formIndex;

  const messagesParam = nodeParameters.find((param) => param.identifier === "messages");

  if (!messagesParam || !Array.isArray(messagesParam.value)) {
    return {
      parameterToUpdate: "messages",
      messagesIndex: adjustedIndex,
      newValue: [],
    };
  }

  return {
    parameterToUpdate: "messages",
    messagesIndex: adjustedIndex,
    newValue: messagesParam.value.map((field, index) =>
      index === adjustedIndex ? { ...field, content: newContent } : field,
    ),
  };
};
