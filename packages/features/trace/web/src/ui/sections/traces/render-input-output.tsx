import type { CollapsedFieldProps } from "@microlink/react-json-view";
import React from "react";
import { TraceInputOutput, type TraceJsonViewOptions } from "../../../index";
import { collectMediaParts, type MediaPartData } from "../../../behavior/shared/traces/media-parts";
import { isPythonRepr, parsePythonInsideJson } from "@langwatch/trace-contract";
import dynamic from "../../../behavior/compat/next-dynamic";
import { CopyIcon } from "../../elements/icons/copy";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { toaster } from "../../blocks/toaster";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { TraceMediaPart } from "./trace-media-part";

const ReactJson = dynamic(() => import("@microlink/react-json-view"), {
  loading: () => <div />,
});

type RenderInputOutputProps = {
  value: unknown;
  showTools?: boolean | "copy-only";
  collapsed?: TraceJsonViewOptions["collapsed"];
  collapseStringsAfterLength?: TraceJsonViewOptions["collapseStringsAfterLength"];
  /**
   * Per-node collapse decision, e.g. "start every array collapsed". Kept here
   * rather than on `TraceJsonViewOptions`: the shared trace component knows
   * only `collapsed` and `collapseStringsAfterLength`, and stays free of the
   * JSON viewer this wrapper happens to render with.
   */
  shouldCollapse?: (field: CollapsedFieldProps) => boolean;
  /** Show the entry count beside each object and array. */
  displayObjectSize?: boolean;
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
      displayObjectSize={props.displayObjectSize ?? false}
      shouldCollapse={props.shouldCollapse}
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
