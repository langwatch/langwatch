/**
 * The slug a dataset name resolves to, and what will happen to it on save.
 *
 * A family-local copy of `platform/app/src/components/datasets/DatasetSlugDisplay`,
 * which the upload confirm drawer still renders. Deletes-only forbids repointing
 * it, so the platform copy stays for that flow and this one travels with the
 * add-or-edit drawer. The alerts themselves already lived in this package.
 */

import { Box, type BoxProps, Field, HStack, Text, VStack } from "@chakra-ui/react";
import type { SlugValidation } from "../../model/dataset-slug-validation";
import { CopyValueButton } from "../elements/copy-value-button";
import { SlugChangeWarningAlert } from "../elements/slug-change-warning-alert";
import { SlugConflictAlert } from "../elements/slug-conflict-alert";

export interface DatasetSlugDisplayProps extends BoxProps {
  /** The slug to show, from the database or from the backend's computation. */
  displaySlug?: string;
  /** Whether saving this name would move the dataset to a different slug. */
  slugWillChange: boolean;
  /** The slug currently stored, shown struck through when it will change. */
  dbSlug?: string;
  slugInfo: SlugValidation;
}

export function DatasetSlugDisplay({
  displaySlug,
  slugWillChange,
  dbSlug,
  slugInfo,
  ...boxProps
}: DatasetSlugDisplayProps) {
  if (!displaySlug) return null;

  const alert =
    slugInfo?.hasConflict && slugInfo.conflictsWith ? (
      <SlugConflictAlert conflictsWith={slugInfo.conflictsWith} />
    ) : !slugInfo?.hasConflict && slugWillChange ? (
      <SlugChangeWarningAlert />
    ) : null;

  return (
    <Box {...boxProps}>
      <Field.HelperText>
        <VStack align="start">
          <HStack>
            <Text
              className="slug-text"
              fontSize="2xs"
              color="fg.muted"
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
              <CopyValueButton value={displaySlug} label="Dataset slug" />
            )}
          </HStack>
          {alert}
        </VStack>
      </Field.HelperText>
    </Box>
  );
}
