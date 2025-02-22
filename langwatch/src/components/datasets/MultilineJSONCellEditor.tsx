import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import type { CustomCellEditorProps } from "@ag-grid-community/react";
import { Textarea, VStack, Text, Alert, Tooltip } from "@chakra-ui/react";
import { ZodError, type ZodType } from "zod";
import { fromZodError } from "zod-validation-error";
import { deepStrict } from "../../utils/zod";

export function MultilineJSONCellEditor({
  value,
  onValueChange,
  zodValidator,
}: CustomCellEditorProps & { zodValidator: ZodType }) {
  const propValueAsString = useMemo(() => {
    if (typeof value === "string") {
      let json;
      try {
        json = JSON.parse(value || "{}");
      } catch {
        json = value;
      }
      return JSON.stringify(json, null, 2);
    } else {
      return JSON.stringify(value, null, 2);
    }
  }, [value]);

  const [localValue, setLocalValue] = useState<string>(propValueAsString);

  const updateValue = useCallback(
    (val: string) => {
      setLocalValue(val);
      onValueChange(val === "" ? null : val);
    },
    [onValueChange]
  );

  useEffect(() => {
    refInput.current?.focus();
  }, []);

  const refInput = useRef<HTMLTextAreaElement>(null);

  const [jsonError, setJsonError] = useState<string | null>(null);

  return (
    <VStack width="100%" minHeight="100%" gap={0}>
      {jsonError && (
        <Tooltip
          maxWidth="700px"
          label={<Text whiteSpace="pre-wrap">{jsonError}</Text>}
        >
          <Alert status="error">
            <Text noOfLines={1}>{jsonError}</Text>
          </Alert>
        </Tooltip>
      )}
      <Textarea
        borderRadius={0}
        resize="none"
        width="100%"
        height="100%"
        minHeight="64px"
        backgroundColor="white"
        fontSize="13px"
        lineHeight="1.5em"
        value={localValue || ""}
        ref={refInput}
        onChange={(event) => {
          try {
            const parsed = JSON.parse(event.target.value);
            deepStrict(zodValidator).parse(parsed);
            setJsonError(null);
            updateValue(event.target.value);
          } catch (e: any) {
            if (e instanceof ZodError) {
              const validationError = fromZodError(e, {
                unionSeparator: ", or\n",
              });
              setJsonError(validationError.message);
            } else {
              setJsonError(e.message);
            }
            setLocalValue(event.target.value);
          }
        }}
      />
    </VStack>
  );
}
