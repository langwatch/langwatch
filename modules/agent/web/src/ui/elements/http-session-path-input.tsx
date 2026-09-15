import { chakra, Field, HStack, Input } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { HelpCircle } from "lucide-react";

const SESSION_PATH_GUIDANCE =
  "JSONPath of a value your endpoint returns for the conversation, such as a conversation id. It is sent back as {{ session }} in the url, the headers and the body on the next turn of the same conversation, and is empty on the first turn.";

export type HttpSessionPathInputProps = {
  value: string;
  onChange: (value: string) => void;
};

export function SessionPathInput({ value, onChange }: HttpSessionPathInputProps) {
  return (
    <Field.Root>
      <HStack gap={1}>
        <Field.Label>Session path</Field.Label>
        <Tooltip content={SESSION_PATH_GUIDANCE} positioning={{ placement: "top" }} showArrow>
          <chakra.button
            type="button"
            aria-label="More about the session path"
            display="flex"
            color="fg.muted"
          >
            <HelpCircle width="14px" />
          </chakra.button>
        </Tooltip>
      </HStack>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="$.conversation_id"
        fontFamily="mono"
        fontSize="13px"
      />
    </Field.Root>
  );
}
