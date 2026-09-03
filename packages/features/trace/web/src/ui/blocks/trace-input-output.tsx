import { Box, Button, HStack, Text, type ButtonProps } from "@chakra-ui/react";
import { memo, useMemo, useState, type ReactNode } from "react";
import { TraceMediaStrip, type TraceMediaPartData } from "../elements/trace-media-strip";

export type TraceJsonViewOptions = {
  collapsed?: boolean | number;
  collapseStringsAfterLength?: number;
};

export type TraceInputOutputProps = {
  value: unknown;
  showTools?: boolean | "copy-only";
  collectMediaParts: (value: unknown) => TraceMediaPartData[];
  renderMediaPart: (part: TraceMediaPartData) => ReactNode;
  isPythonRepr: (value: string) => boolean;
  parsePythonInsideJson: (value: unknown) => unknown;
  renderJsonViewer: (value: object, options: TraceJsonViewOptions) => ReactNode;
  copyToClipboard: (value: string) => Promise<void>;
  onCopyFailure: () => void;
  copyIcon: ReactNode;
  renderTooltip: (content: string, child: ReactNode) => ReactNode;
  collapsed?: boolean | number;
  collapseStringsAfterLength?: number;
};

export const TraceInputOutput = memo(function TraceInputOutput({
  value: initialValue,
  showTools,
  collectMediaParts,
  renderMediaPart,
  isPythonRepr,
  parsePythonInsideJson,
  renderJsonViewer,
  copyToClipboard,
  onCopyFailure,
  copyIcon,
  renderTooltip,
  collapsed,
  collapseStringsAfterLength,
}: TraceInputOutputProps) {
  let value = initialValue;
  let json: object | undefined;

  try {
    if (typeof value === "string") {
      const parsed: unknown = JSON.parse(value);

      if (typeof parsed === "object" && parsed !== null) {
        json = parsed;
      }

      if (typeof parsed === "string") {
        value = parsed;
      }
    }

    if (typeof value === "object" && value !== null) {
      json = value;
    }
  } catch {
    // Non-JSON strings are displayed as text below.
  }

  const [raw, setRaw] = useState(false);
  const mediaParts = useMemo(() => collectMediaParts(json ?? value), [value]);

  const copyValue = () => {
    if (json) {
      return JSON.stringify(json, null, 2);
    }

    if (value) {
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }

    return `${value}`;
  };

  const copy = () => {
    try {
      void copyToClipboard(copyValue()).catch(onCopyFailure);
    } catch {
      onCopyFailure();
    }
  };

  const copyButton = (
    <Box>
      <TinyButton position="relative" onClick={copy}>
        {copyIcon}
      </TinyButton>
    </Box>
  );

  const renderCopyButton = () => renderTooltip("Copy", copyButton);

  const renderJson = (object: unknown) => {
    const parsed = parsePythonInsideJson(object);
    const forceRaw = typeof parsed !== "object" || parsed === null;

    return (
      <>
        {showTools && (
          <HStack position="absolute" top={-2} right={-2} zIndex={1} gap="-1px">
            {!forceRaw && showTools !== "copy-only" && (
              <Box>
                {renderTooltip(
                  "View Raw",
                  <TinyButton
                    onClick={() => setRaw((current) => !current)}
                    background={raw ? "bg.emphasized" : "bg.muted"}
                  >
                    {"{}"}
                  </TinyButton>,
                )}
              </Box>
            )}
            {renderCopyButton()}
          </HStack>
        )}
        {raw || forceRaw ? (
          <Text fontFamily="mono" fontSize="13px">
            {JSON.stringify(object, null, 2)}
          </Text>
        ) : (
          renderJsonViewer(parsed, {
            collapsed,
            collapseStringsAfterLength,
          })
        )}
      </>
    );
  };

  const showJson =
    typeof document !== "undefined" &&
    (json !== void 0 || (typeof value === "string" && isPythonRepr(value)));

  return (
    <Box position="relative" width="full">
      <TraceMediaStrip parts={mediaParts} renderPart={renderMediaPart} />
      {showJson ? (
        renderJson(json ?? value)
      ) : (
        <>
          {showTools && (
            <HStack position="absolute" top={-2} right={-2} zIndex={1} gap="-1px">
              {renderCopyButton()}
            </HStack>
          )}
          <Text fontFamily="mono" fontSize="14px">
            {formatDisplayValue(value)}
          </Text>
        </>
      )}
    </Box>
  );
});

function formatDisplayValue(value: unknown): string | undefined {
  if (!value) {
    return `${value}`;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

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
      borderColor="border.emphasized"
      colorPalette="gray"
      {...props}
    />
  );
}
