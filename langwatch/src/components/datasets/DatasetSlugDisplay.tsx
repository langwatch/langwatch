import { useCallback } from "react";
import {
  Field,
  Text,
  VStack,
  Box,
  type BoxProps,
  HStack,
} from "@chakra-ui/react";
import type { SlugValidationResult } from "./useDatasetSlugValidation";
import { SlugChangeWarningAlert } from "./SlugChangeWarningAlert";
import { SlugConflictAlert } from "./SlugConflictAlert";
import { CopyButton } from "../CopyButton";

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
          <HStack>
            <Text
              className="slug-text"
              fontSize="2xs"
              color="gray.600"
              textAlign="left"
              transition="opacity 0.2s"
              minWidth={0}
            >
              slug:{" "}
              {slugWillChange ? (
                <>
                  <Text as="span" textDecoration="line-through">
                    {dbSlug}
                  </Text>
                  {" -> "}
                  <b> {displaySlug}</b>
                </>
              ) : (
                displaySlug
              )}
            </Text>
            {!slugWillChange && displaySlug && (
              <CopyButton value={displaySlug} label="Dataset slug" />
            )}
          </HStack>
          {renderAlert()}
        </VStack>
      </Field.HelperText>
    </Box>
  );
}
