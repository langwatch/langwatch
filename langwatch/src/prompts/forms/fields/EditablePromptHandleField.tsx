import { HStack, type StackProps, Text } from "@chakra-ui/react";
import clsx from "clsx";
import { useFormContext } from "react-hook-form";

import type { PromptConfigFormValues } from "~/prompts";
import { CopyButton } from "../../../components/CopyButton";
import { EditPromptHandleButton } from "./EditPromptHandleButton";

type EditablePromptHandleFieldProps = StackProps;

/**
 * EditablePromptHandleField component
 * Single Responsibility: Displays prompt handle with edit and copy buttons
 * @param props - EditablePromptHandleFieldProps extending StackProps
 * @returns JSX.Element - Renders an editable prompt handle display with edit and copy buttons
 */
export function EditablePromptHandleField(
  props: EditablePromptHandleFieldProps,
) {
  const form = useFormContext<PromptConfigFormValues>();
  const handle = form.watch("handle");

  return (
    <HStack
      paddingX={1}
      gap={1}
      width="full"
      position="relative"
      minWidth="80px"
      _hover={{
        "& .handle-text": {
          opacity: 0.4,
        },
        "& .handle-actions": {
          opacity: 1,
        },
      }}
      {...props}
      className={clsx("group", props.className)}
    >
      {handle ? (
        <Text
          className="handle-text"
          fontSize="sm"
          fontWeight="500"
          fontFamily="mono"
          textWrap="wrap"
          minWidth={0}
          overflow="hidden"
          transition="opacity 0.2s"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
        >
          {handle}
        </Text>
      ) : (
        <Text color="gray.500">Draft</Text>
      )}
      {handle && (
        <HStack
          className="handle-actions"
          position="absolute"
          right={1}
          opacity={0}
          transition="opacity 0.2s"
          gap={1}
          background="gray.50"
          paddingX={1}
          borderRadius="lg"
        >
          <EditPromptHandleButton />
          <CopyButton value={handle} label="Prompt ID" />
        </HStack>
      )}
    </HStack>
  );
}
