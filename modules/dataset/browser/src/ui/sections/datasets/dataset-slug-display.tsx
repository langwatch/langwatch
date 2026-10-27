import {
  Box,
  type BoxProps,
  Field,
  HStack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { useCallback } from "react";

import type { SlugValidationResult } from "../../../behavior/datasets/use-dataset-slug-validation.ts";
import { SlugChangeWarningAlert } from "../../elements/slug-change-warning-alert.tsx";
import { SlugConflictAlert } from "../../elements/slug-conflict-alert.tsx";

/**
 * Props for DatasetSlugDisplay.
 */
export interface DatasetSlugDisplayProps extends BoxProps {
  /**
   * The slug to display (from DB or backend computation)
   */
  displaySlug?: string;
  /**
   * Whether the slug will change on save
   */
  slugWillChange: boolean;
  /**
   * Current database slug (for showing change indicator)
   */
  dbSlug?: string;
  /**
   * Validation result from backend
   */
  slugInfo: SlugValidationResult;
}

/**
 * Component for displaying dataset slug with validation feedback.
 *
 * Single Responsibility: Renders slug display with conflict warnings.
 */
export function DatasetSlugDisplay({
  displaySlug,
  slugWillChange,
  dbSlug,
  slugInfo,
  ...boxProps
}: DatasetSlugDisplayProps) {
  /**
   * Renders the appropriate alert based on the slug info and slug will change.
   */
  const renderAlert = useCallback(() => {
    if (slugInfo?.hasConflict && slugInfo.conflictsWith) {
      return <SlugConflictAlert conflictsWith={slugInfo.conflictsWith} />;
    }
    if (!slugInfo?.hasConflict && slugWillChange) {
      return <SlugChangeWarningAlert />;
    }
    return null;
  }, [slugInfo, slugWillChange]);

  if (!displaySlug) {
    return null;
  }

  return (
    <Box {...boxProps}>
      <Field.HelperText>
        <VStack align="start">
          {slugWillChange && (
            <HStack>
              <Text
                className="slug-text"
                textStyle="micro"
                color="fg.muted"
                textAlign="left"
                transition="opacity 0.2s"
                minWidth={0}
              >
                slug:{" "}
                {
                  <>
                    <Text as="span" textDecoration="line-through">
                      {dbSlug}
                    </Text>
                    {" -> "}
                    <b> {displaySlug}</b>
                  </>
                }
              </Text>
            </HStack>
          )}
          {renderAlert()}
        </VStack>
      </Field.HelperText>
    </Box>
  );
}
