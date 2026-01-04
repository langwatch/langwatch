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

/**
 * Computes which parameter to update when adding a variable to a message.
 *
 * The form's messages array includes the system message at index 0,
 * but the node's "messages" parameter does NOT include the system message
 * (it's stored separately in the "instructions" parameter).
 *
 * This function correctly maps the form index to the right parameter and index.
 */
export const computeMessageEdgeUpdate = ({
  formMessages,
  nodeParameters,
  formIndex,
  newContent,
}: ComputeMessageEdgeUpdateParams): ComputeMessageEdgeUpdateResult => {
  // Check if the edited message is a system message
  const editedMessage = formMessages[formIndex];
  const isSystemMessage = editedMessage?.role === "system";

  if (isSystemMessage) {
    // Update instructions parameter instead of messages
    return {
      parameterToUpdate: "instructions",
      newValue: newContent,
    };
  }

  // Calculate the adjusted index for non-system messages
  // The form has [system, user, assistant, ...] but node messages has [user, assistant, ...]
  const systemIndex = formMessages.findIndex((m) => m.role === "system");
  const adjustedIndex = systemIndex >= 0 && formIndex > systemIndex ? formIndex - 1 : formIndex;

  const messagesParam = nodeParameters.find(
    (param) => param.identifier === "messages",
  );

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
    newValue: messagesParam.value.map((field, i) =>
      i === adjustedIndex ? { ...field, content: newContent } : field,
    ),
  };
};

