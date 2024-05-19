import React, { useRef, useEffect, useState } from "react";
import type { CustomCellEditorProps } from "ag-grid-react";
import { Textarea, VStack, Text, useToast, Alert } from "@chakra-ui/react";

export const MultilineJSONCellEditor = React.forwardRef(
  (props: CustomCellEditorProps, ref) => {
    const { value, onValueChange } = props;
    const updateValue = (val: string) => {
      onValueChange(val === "" ? null : val);
    };

    useEffect(() => {
      if (typeof value === "string") {
        let json = JSON.parse(value);
        if (typeof json === "string") {
          try {
            json = JSON.parse(json);
          } catch {
            json = value;
          }
        }
        updateValue(JSON.stringify(json, null, 2));
      } else {
        updateValue(JSON.stringify(value, null, 2));
      }

      refInput.current?.focus();
    }, []);

    const refInput = useRef<HTMLTextAreaElement>(null);
    const toast = useToast();

    const [jsonError, setJsonError] = useState<string | null>(null);

    return (
      <VStack width="100%" minHeight="100%" spacing={0}>
        {jsonError && <Alert status="error">{jsonError}</Alert>}
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
              JSON.parse(event.target.value);
              setJsonError(null);
              updateValue(event.target.value);
            } catch (e: any) {
              setJsonError(e.message);
              toast({
                title: "Invalid JSON",
                status: "error",
                duration: 3000,
              });
            }
          }}
        />
      </VStack>
    );
  }
);
