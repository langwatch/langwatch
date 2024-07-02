import { Link } from "@chakra-ui/next-js";
import { Button, Tooltip } from "@chakra-ui/react";
import { projectRoutes } from "~/utils/routes";
import { Image as ImageIcon } from "react-feather";
import React from "react";
/**
 * Compose the link to the playground with the given project slug, trace ID, and
 * span ID.
 *
 * The playground link is composed of the project slug, trace ID, and span ID in
 * the following format:
 *  /[projectSlug]/playground?traceId=[traceId]&span=[spanId]
 *
 * @param projectSlug - The project slug to link to.
 * @param traceId - The trace ID to load in the playground.
 * @param spanId - The span ID to load in the playground.
 * @returns The link to the playground with the given trace and span.
 */
function useLinkHref(projectSlug: string, traceId: string, spanId: string) {
  return React.useMemo(() => {
    const queryString = new URLSearchParams({
      traceId,
      span: spanId,
    }).toString();

    const path = projectRoutes.playground.path.replace(
      "[project]",
      projectSlug
    );

    return `${path}?${queryString}`;
  }, [projectSlug, traceId, spanId]);
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace TraceToPlaygroundLink {
  export interface Props {
    /**
     * Reference to the project the trace belongs to.
     */
    projectSlug: string;
    /**
     * The trace ID to load in the playground.
     */
    traceId: string;
    /**
     * The span ID to load in the playground.
     */
    spanId: string;
    /**
     * The label to display in the tooltip when hovering over the button.
     */
    tooltipLabel?: string;
    /**
     * The label to display on the button.
     */
    buttonLabel?: string;
  }

  export type Component = React.FC<Props>;
}
/**
 * Display a button that forwards the user to the playground to load a
 * specific trace and span.
 */
export const TraceToPlaygroundLink: TraceToPlaygroundLink.Component = ({
  projectSlug,
  traceId,
  spanId,
  tooltipLabel,
  buttonLabel,
}) => {
  const linkHref = useLinkHref(projectSlug, traceId, spanId);

  return (
    <Tooltip label={tooltipLabel} hasArrow placement="right" gutter={16}>
      <Link href={linkHref} aria-label={tooltipLabel}>
        <Button leftIcon={<ImageIcon />} variant="outline">
          {buttonLabel}
        </Button>
      </Link>
    </Tooltip>
  );
};

TraceToPlaygroundLink.displayName = "TraceToPlaygroundLink";
