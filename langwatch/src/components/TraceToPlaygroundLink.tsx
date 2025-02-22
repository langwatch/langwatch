import { Link } from "./ui/link";
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

export function TraceToPlaygroundLink({
  projectSlug,
  traceId,
  spanId,
  tooltipLabel,
  buttonLabel,
}: TraceToPlaygroundLink.Props): JSX.Element {
  const linkHref = `/${projectSlug}/playground?${new URLSearchParams({
    traceId,
    span: spanId,
  }).toString()}`;

  return (
    <Tooltip label={tooltipLabel} hasArrow placement="right" gutter={16}>
      <Link
        as={Button}
        href={linkHref}
        aria-label={tooltipLabel}
        variant="outline"
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
