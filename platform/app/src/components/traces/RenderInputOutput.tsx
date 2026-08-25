import type { ReactJsonViewProps } from "@microlink/react-json-view";
import React from "react";
import { TraceInputOutput, type TraceJsonViewOptions } from "@langwatch/trace-web";
import type { SpanInputOutput } from "~/server/tracer/types";
import { collectMediaParts, type MediaPartData } from "~/shared/traces/mediaParts";
import { isPythonRepr, parsePythonInsideJson } from "../../utils/parsePythonInsideJson";
import dynamic from "~/utils/compat/next-dynamic";
import { CopyIcon } from "../icons/Copy";
import { useColorMode } from "../ui/color-mode";
import { toaster } from "../ui/toaster";
import { Tooltip } from "../ui/tooltip";
import { TraceMediaPart } from "./TraceMediaPart";

const ReactJson = dynamic(() => import("@microlink/react-json-view"), {
  loading: () => <div />,
});

type RenderInputOutputProps = {
  value: SpanInputOutput["value"] | string | undefined;
  showTools?: boolean | "copy-only";
  collapsed?: ReactJsonViewProps["collapsed"];
  collapseStringsAfterLength?: ReactJsonViewProps["collapseStringsAfterLength"];
};

export const RenderInputOutput = React.memo(function RenderInputOutput(
  props: RenderInputOutputProps,
) {
  const { colorMode } = useColorMode();

  const copyToClipboard = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toaster.create({
      title: "Copied to clipboard",
      type: "success",
    });
  };

  const onCopyFailure = () => {
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
  };

  const renderJsonViewer = (value: object, options: TraceJsonViewOptions) => (
    <ReactJson
      src={value}
      name={false}
      displayDataTypes={false}
      displayObjectSize={false}
      enableClipboard={false}
      collapseStringsAfterLength={options.collapseStringsAfterLength ?? 1000}
      collapsed={options.collapsed}
      style={{
        fontSize: "13px",
        backgroundColor: "transparent",
      }}
      theme={colorMode === "dark" ? "twilight" : "rjv-default"}
      displayArrayKey={false}
    />
  );

  return (
    <TraceInputOutput
      value={props.value}
      showTools={props.showTools}
      collectMediaParts={collectMediaParts}
      renderMediaPart={(part: MediaPartData) => <TraceMediaPart part={part} />}
      isPythonRepr={isPythonRepr}
      parsePythonInsideJson={(value) => {
        if (typeof value === "object" && value !== null) {
          return parsePythonInsideJson(value);
        }

        if (typeof value === "string" && isPythonRepr(value)) {
          const parsed = parsePythonInsideJson({ value });

          if (typeof parsed === "object" && parsed !== null && "value" in parsed) {
            return parsed.value;
          }
        }

        return value;
      }}
      renderJsonViewer={renderJsonViewer}
      copyToClipboard={copyToClipboard}
      onCopyFailure={onCopyFailure}
      copyIcon={<CopyIcon width={12} height={12} />}
      renderTooltip={(content, child) => <Tooltip content={content}>{child}</Tooltip>}
      collapsed={props.collapsed}
      collapseStringsAfterLength={props.collapseStringsAfterLength}
    />
  );
});
