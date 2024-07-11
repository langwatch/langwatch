import { Link } from "@chakra-ui/next-js";
import {
  Button,
  Tooltip,
  Flex,
  Box,
  type ButtonProps,
  type PlacementWithLogical,
} from "@chakra-ui/react";
import { Image as ImageIcon } from "react-feather";
import React from "react";

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace TraceToPlaygroundLink {
  export interface Props {
    projectSlug: string;
    traceId: string;
    spanId: string;
    tooltipLabel?: string;
    buttonLabel?: string;
    tooltipGutterSize?: number;
    tooltipPlacement?: PlacementWithLogical;
    buttonVariant?: ButtonProps["variant"];
  }
}

const DEFAULT_TOOLTIP_GUTTER_SIZE = 16;

const DEFAULT_TOOLTIP_PLACEMENT: PlacementWithLogical = "right";

const DEFAULT_BUTTON_VARIANT = "outline";

export function TraceToPlaygroundLink({
  projectSlug,
  traceId,
  spanId,
  tooltipLabel,
  buttonLabel,
  tooltipGutterSize = DEFAULT_TOOLTIP_GUTTER_SIZE,
  tooltipPlacement = DEFAULT_TOOLTIP_PLACEMENT,
  buttonVariant = DEFAULT_BUTTON_VARIANT,
}: TraceToPlaygroundLink.Props): JSX.Element {
  const linkHref = `/${projectSlug}/playground?${new URLSearchParams({
    traceId,
    span: spanId,
  }).toString()}`;

  return (
    <Tooltip
      label={tooltipLabel}
      hasArrow
      placement={tooltipPlacement}
      gutter={tooltipGutterSize}
    >
      <Link
        as={Button}
        href={linkHref}
        aria-label={tooltipLabel}
        variant={buttonVariant}
      >
        <Flex align="center" justify="center">
          <Box mr={2}>
            <ImageIcon />
          </Box>
          {buttonLabel}
        </Flex>
      </Link>
    </Tooltip>
  );
}
