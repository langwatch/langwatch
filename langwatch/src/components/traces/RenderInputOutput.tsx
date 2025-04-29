import React from "react";
import { Box, Button, HStack, Text, type ButtonProps } from "@chakra-ui/react";
import { Tooltip } from "../ui/tooltip";
import { toaster } from "../ui/toaster";
import type { ReactJsonViewProps } from "@microlink/react-json-view";
import dynamic from "next/dynamic";
import { useState } from "react";
import {
  isPythonRepr,
  parsePythonInsideJson,
} from "../../utils/parsePythonInsideJson";
import { CopyIcon } from "../icons/Copy";
import type { SpanInputOutput } from "~/server/tracer/types";

export const RenderInputOutput = React.memo(function RenderInputOutput(
  props: Partial<ReactJsonViewProps> & {
    value: SpanInputOutput['value'] | string | undefined;
    showTools?: boolean | "copy-only";
  }
) {
  let { value } = props;
  const ReactJson = dynamic(() => import("@microlink/react-json-view"), {
    loading: () => <div />,
  });

  let json: object | undefined;
  try {
    if (value && typeof value === "string") {
      const json_ = JSON.parse(value);
      if (typeof json_ === "object") {
        json = json_;
      }
      if (typeof json_ === "string") {
        value = json_;
      }
    }
    if (typeof value === "object" && value !== null) {
      json = value;
    }
  } catch (e) {}

  const propsWithoutValue = { ...props };
  delete propsWithoutValue.value;

  const [raw, setRaw] = useState(false);

  const renderCopyButton = () => {
    return (
      <Tooltip content="Copy">
        <Box>
          <TinyButton
            position="relative"
            onClick={() => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(
                    json
                      ? JSON.stringify(json, null, 2)
                      : value
                      ? typeof value === "string"
                        ? value
                        : (value as any).toString()
                      : `${value}`
                  );
                  toaster.create({
                    title: "Copied to clipboard",
                    type: "success",
                  });
                } catch (e) {
                  if (
                    window.location.protocol === "http:" &&
                    window.location.hostname !== "localhost" &&
                    window.location.hostname !== "127.0.0.1"
                  ) {
                    toaster.create({
                      title: "Cannot copy to clipboard on HTTP",
                      type: "error",
                    });
                    return;
                  }
                  toaster.create({
                    title: "Failed to copy to clipboard",
                    type: "error",
                  });
                }
              })();
            }}
          >
            <CopyIcon width={12} height={12} />
          </TinyButton>
        </Box>
      </Tooltip>
    );
  };

  const renderJson = (json: object) => {
    const json_ = parsePythonInsideJson(json);

    let forceRaw = false;
    if (typeof json_ !== "object") {
      forceRaw = true;
    }

    return (
      <>
        {props.showTools && (
          <HStack position="absolute" top={-2} right={-2} zIndex={1} gap="-1px">
            {!forceRaw && props.showTools !== "copy-only" && (
              <Tooltip content="View Raw">
                <Box>
                  <TinyButton
                    onClick={() => setRaw(!raw)}
                    background={raw ? "gray.200" : "gray.100"}
                  >
                    {"{}"}
                  </TinyButton>
                </Box>
              </Tooltip>
            )}
            {renderCopyButton()}
          </HStack>
        )}
        {raw || forceRaw ? (
          <Text fontFamily="mono" fontSize="13px">
            {JSON.stringify(json, null, 2)}
          </Text>
        ) : (
          <ReactJson
            src={json_}
            name={false}
            displayDataTypes={false}
            displayObjectSize={false}
            enableClipboard={false}
            collapseStringsAfterLength={1000}
            style={{ fontSize: "13px" }}
            //@ts-ignore
            displayArrayKey={false}
            {...propsWithoutValue}
          />
        )}
      </>
    );
  };

  return (
    <Box position="relative" width="full">
      {typeof document !== "undefined" &&
      (json ?? (typeof value === "string" && isPythonRepr(value))) ? (
        renderJson(json ?? (value as any))
      ) : (
        <>
          {props.showTools && (
            <HStack
              position="absolute"
              top={-2}
              right={-2}
              zIndex={1}
              gap="-1px"
            >
              {renderCopyButton()}
            </HStack>
          )}
          <Text fontFamily="mono" fontSize="14px">
            {value
              ? typeof value === "string"
                ? value
                : (value as any).toString()
              : `${value}`}
          </Text>
        </>
      )}
    </Box>
  );
});
function TinyButton(props: ButtonProps) {
  return (
    <Button
      size="xs"
      fontSize="10px"
      fontFamily="mono"
      padding={1}
      height="22px"
      width="auto"
      minWidth="0"
      borderRadius="0"
      border="1px solid"
      borderColor="gray.300"
      colorPalette="gray"
      {...props}
    />
  );
}

