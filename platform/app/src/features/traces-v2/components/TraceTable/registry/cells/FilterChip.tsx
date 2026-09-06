import { Box, type BoxProps, chakra, Icon } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import type React from "react";
import { forwardRef } from "react";
import { Link } from "~/components/ui/link";

interface FilterChipBaseProps {
  /** Toggle the facet filter for this value. */
  onFilter: () => void;
  /** Accessible description of the filter action, e.g.
   *  "Filter by label fake-conversation". */
  filterLabel: string;
  children: React.ReactNode;
}

/**
 * The ↗ link-out is all-or-nothing: when `openHref` is set, `openLabel`
 * must accompany it so the icon-only link always has an accessible name.
 */
type FilterChipProps = FilterChipBaseProps &
  (
    | {
        /** Optional in-app link-out target. When set, a trailing ↗ icon
         *  reveals on hover to jump to the value's source/definition. */
        openHref: string;
        /** Accessible label for the ↗ link, e.g.
         *  "Open model provider settings". */
        openLabel: string;
      }
    | { openHref?: undefined; openLabel?: undefined }
  );

/**
 * Shared interaction wrapper for the trace table's value chips (label,
 * model, evaluation, prompt). One consistent behaviour everywhere:
 *
 *   - clicking the chip body toggles a facet filter for that value —
 *     `stopPropagation` keeps it from opening the row's trace drawer;
 *   - an optional ↗ link-out fades in at the trailing edge on hover and
 *     navigates to the value's source (provider, definition, prompt…).
 *
 * The ↗ keeps its layout slot even while hidden, so a chip doesn't shift
 * as the icon fades in. `forwardRef` + prop spread let the chip double as
 * a HoverCard trigger (the model cell wraps it in the multi-model list
 * popover).
 */
export const FilterChip = forwardRef<
  HTMLDivElement,
  FilterChipProps & Omit<BoxProps, "onClick" | "children">
>(function FilterChip(
  { onFilter, filterLabel, openHref, openLabel, children, ...rest },
  ref,
) {
  return (
    <Box
      ref={ref}
      className="group"
      display="inline-flex"
      alignItems="center"
      gap={0.5}
      minWidth={0}
      maxWidth="full"
      {...rest}
    >
      <chakra.button
        type="button"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          onFilter();
        }}
        aria-label={filterLabel}
        title={filterLabel}
        display="inline-flex"
        alignItems="center"
        minWidth={0}
        cursor="pointer"
        borderRadius="md"
        transition="opacity 0.12s"
        _hover={{ opacity: 0.82 }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "blue.focusRing",
          outlineOffset: "1px",
        }}
      >
        {children}
      </chakra.button>
      {openHref && (
        <Link
          href={openHref}
          aria-label={openLabel}
          title={openLabel}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          display="inline-flex"
          alignItems="center"
          flexShrink={0}
          color="fg.subtle"
          opacity={0}
          transition="opacity 0.12s, color 0.12s"
          _groupHover={{ opacity: 1 }}
          _hover={{ color: "fg" }}
        >
          <Icon boxSize={3}>
            <ArrowUpRight />
          </Icon>
        </Link>
      )}
    </Box>
  );
});
