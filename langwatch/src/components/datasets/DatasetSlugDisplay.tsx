import { Field, Text, VStack, Box, type BoxProps } from "@chakra-ui/react";
import type { SlugValidationResult } from "./useDatasetSlugValidation";
import { SlugChangeWarningAlert } from "./SlugChangeWarningAlert";
import { SlugConflictAlert } from "./SlugConflictAlert";

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
  if (!displaySlug) {
    return null;
  }

  return (
    <Box {...boxProps}>
      <Field.HelperText>
        <VStack align="start">
          <Text fontSize="2xs" color="gray.600" textAlign="left">
            slug: {slugWillChange ? (
              <>
                <Text as="span" textDecoration="line-through">{dbSlug}</Text>
                {" -> "}
                <b> {displaySlug}</b>
              </>
            ) : displaySlug}
          </Text>
          {slugWillChange && <SlugChangeWarningAlert />}
        </VStack>
      </Field.HelperText>

      {slugInfo?.hasConflict && slugInfo.conflictsWith && (
        <SlugConflictAlert conflictsWith={slugInfo.conflictsWith} />
      )}
    </Box>
  );
}
