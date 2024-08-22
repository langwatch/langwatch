import React, { useRef, useEffect, useState, useCallback } from "react";
import type { CustomCellEditorProps } from "@ag-grid-community/react";
import { Textarea, VStack, Text, Alert, Tooltip } from "@chakra-ui/react";
import { ZodError, type ZodType } from "zod";
import { fromZodError } from "zod-validation-error";
import { deepStrict } from "../../utils/zod";

export function MultilineJSONCellEditor(
  props: CustomCellEditorProps & { zodValidator: ZodType }
) {
  const { value, onValueChange } = props;
  const updateValue = useCallback(
    (val: string) => {
      onValueChange(val === "" ? null : val);
    },
    [onValueChange]
  );

  useEffect(() => {
    if (typeof value === "string") {
      let json = JSON.parse(value || '{}');
      if (typeof json === "string") {
        try {
          json = JSON.parse(json || '{}');
        } catch {
          json = value;
        }
      }
      updateValue(JSON.stringify(json, null, 2));
    } else {
      updateValue(JSON.stringify(value, null, 2));
    }

    refInput.current?.focus();
  }, [updateValue, value]);

  const refInput = useRef<HTMLTextAreaElement>(null);

  const [jsonError, setJsonError] = useState<string | null>(null);

  return (
    <VStack width="100%" minHeight="100%" spacing={0}>
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
        minHeight="0"
        fontSize="13px"
        lineHeight="1.5em"
        value={value || ""}
        ref={refInput}
        onChange={(event) => {
          try {
            const parsed = JSON.parse(event.target.value);
            deepStrict(props.zodValidator).parse(parsed);
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
          }
        }}
      />
    </VStack>
  );
}
