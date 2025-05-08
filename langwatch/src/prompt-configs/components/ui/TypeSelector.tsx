import {
  Box,
  Button,
  HStack,
  NativeSelect,
  useDisclosure,
  Text,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "react-feather";
import { LuBraces } from "react-icons/lu";
import { TypeLabel } from "~/optimization_studio/components/nodes/Nodes";
import type { LlmConfigInputType, LlmConfigOutputType } from "~/types";
import { Dialog } from "~/components/ui/dialog";
import { CodeEditor } from "~/optimization_studio/components/code/CodeEditorModal";
import Ajv from "ajv";
import { outputsSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";
import { fromZodError } from "zod-validation-error";

/**
 * Type selector with dropdown for field types
 * ie: str, image, float, int, bool, llm, prompting_technique, dataset, code, list[str]
 */
export function TypeSelector({
  name,
  value,
  jsonSchema,
  onChange,
  isInput,
  readOnly,
}: {
  name: string;
  value: string;
  jsonSchema?: object;
  onChange: (value: string, jsonSchema?: object) => void;
  isInput?: boolean;
  readOnly?: boolean;
}) {
  const jsonSchemaDialog = useDisclosure();
  const defaultJsonSchema = {
    type: "object",
    properties: {
      result: {
        type: "string",
      },
    },
    required: ["result"],
  };

  return (
    <>
      <HStack
        position="relative"
        background="white"
        borderRadius="8px"
        paddingX={2}
        paddingY={1}
        gap={2}
        height="full"
      >
        <Box fontSize="13px">
          <TypeLabel type={value} />
        </Box>
        {!readOnly && (
          <>
            <Box color="gray.600">
              <ChevronDown size={14} />
            </Box>
            <NativeSelect.Root
              position="absolute"
              top={0}
              left={0}
              height="32px"
              width="100%"
              cursor="pointer"
              zIndex={10}
              opacity={0}
            >
              <NativeSelect.Field
                name={name}
                value={value}
                onChange={(e) => {
                  if (e.target.value === "json_schema") {
                    onChange(e.target.value, defaultJsonSchema);
                    jsonSchemaDialog.onOpen();
                  } else {
                    onChange(e.target.value);
                  }
                }}
              >
                {isInput ? <InputOptions /> : <OutputOptions />}
              </NativeSelect.Field>
            </NativeSelect.Root>
          </>
        )}
      </HStack>
      {value === "json_schema" && (
        <Button
          size="xs"
          background="white"
          height="auto"
          paddingY="6px"
          paddingX={2}
          borderRadius="8px"
          onClick={() => jsonSchemaDialog.onOpen()}
        >
          <LuBraces />
        </Button>
      )}
      <JsonSchemaDialog
        open={jsonSchemaDialog.open}
        onClose={jsonSchemaDialog.onClose}
        value={jsonSchema ?? {}}
        onChange={(jsonSchema) => onChange(value, jsonSchema)}
      />
    </>
  );
}

function InputOptions() {
  return (
    <>
      <InputOption type="str" />
      <InputOption type="image" />
      <InputOption type="float" />
      <InputOption type="bool" />
    </>
  );
}

function OutputOptions() {
  return (
    <>
      <OutputOption type="str" />
      <OutputOption type="float" />
      <OutputOption type="bool" />
      <OutputOption type="json_schema" />
    </>
  );
}

function InputOption({ type }: { type: LlmConfigInputType }) {
  return <option value={type}>{type}</option>;
}

function OutputOption({ type }: { type: LlmConfigOutputType }) {
  return <option value={type}>{type}</option>;
}

function JsonSchemaDialog({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: object;
  onChange: (jsonSchema: object) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string>(JSON.stringify(value, null, 2));

  useEffect(() => {
    const code = JSON.stringify(value, null, 2);
    setCode(code);
    checkForErrors(code);
  }, [value, open]);

  const checkForErrors = useCallback(
    (code: string) => {
      const error = checkForJsonSchemaErrors(code);
      if (error) {
        setError(error);
      } else {
        setError(null);
      }
    },
    [setError]
  );

  return (
    <Dialog.Root
      size="lg"
      open={open}
      onOpenChange={({ open }) => {
        if (!open) {
          if (
            JSON.stringify(value, null, 2) !== code &&
            !confirm("Changes will be lost. Are you sure?")
          ) {
            return;
          }
          onClose();
        }
      }}
    >
      <Dialog.Backdrop />
      <Dialog.Content margin="64px" background="#272822" color="white">
        <Dialog.Header>
          <Dialog.Title>JSON Schema</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger color="white" _hover={{ color: "black" }} />
        <Dialog.Body>
          <Box height="400px">
            {open && (
              <CodeEditor
                code={code}
                setCode={(code) => {
                  setCode(code);
                  checkForErrors(code);
                }}
                onClose={onClose}
                language="json"
                technologies={["json", "json schema"]}
              />
            )}
            {error && <Text>Error: {error}</Text>}
          </Box>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            onClick={() => {
              onChange(JSON.parse(code));
              onClose();
            }}
            variant="outline"
            color="white"
            colorPalette="white"
            size="lg"
            disabled={!!error}
            _hover={{ color: "black" }}
          >
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

const ajv = new Ajv();

const checkForJsonSchemaErrors = (jsonSchemaString: string) => {
  try {
    const schema = JSON.parse(jsonSchemaString);
    const valid = ajv.validateSchema(schema);
    if (!valid) {
      return ajv.errorsText();
    }
    const jsonSchemaValidation =
      outputsSchema.shape.json_schema.safeParse(schema);
    if (!jsonSchemaValidation.success) {
      const validationError = fromZodError(jsonSchemaValidation.error);
      return validationError.message;
    }
    return null;
  } catch (err) {
    return (err as Error).message;
  }
};
