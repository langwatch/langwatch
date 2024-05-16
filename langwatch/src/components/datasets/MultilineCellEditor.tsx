import React, { useRef, useEffect } from "react";
import type { ICellEditorParams } from "ag-grid-community";
import type { CustomCellEditorProps } from "ag-grid-react";
import { Textarea } from "@chakra-ui/react";

export const MultilineCellEditor = React.forwardRef(
  (props: CustomCellEditorProps, ref) => {
    const { value, onValueChange, eventKey, rowIndex, column } = props;
    const updateValue = (val: string) => {
      onValueChange(val === "" ? null : val);
    };

    useEffect(() => {
      // let startValue;
      // console.log("eventKey", eventKey)

      // if (eventKey === "Backspace") {
      //   startValue = "";
      // } else if (eventKey && eventKey.length === 1) {
      //   startValue = eventKey;
      // } else {
      //   startValue = value;
      // }
      // if (startValue == null) {
      //   startValue = "";
      // }

      updateValue(value);

      refInput.current?.focus();
    }, []);

    const refInput = useRef<HTMLTextAreaElement>(null);

    return (
      <Textarea
        resize="none"
        width="100%"
        height="100%"
        minHeight="0"
        fontSize="14px"
        lineHeight="1.5em"
        value={value || ""}
        ref={refInput}
        onKeyDown={(event) => {
          console.log("key", event.key);
          if (event.key === "Enter" && event.shiftKey) {
            console.log("HEEEEEEEEEEEEEEEEEERE");
            event.stopPropagation();
          }
        }}
        onChange={(event) => updateValue(event.target.value)}
      />
    );
  }
);
