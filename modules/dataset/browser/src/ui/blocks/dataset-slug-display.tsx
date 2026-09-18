/**
 * The slug a dataset name resolves to, and what will happen on save. A
 * family-local copy of `platform/app/.../DatasetSlugDisplay`: deletes-only
 * forbids repointing it, so this one travels with the add-or-edit drawer.
 */

import { Box, type BoxProps, Field, HStack, Text, VStack } from "@chakra-ui/react";

import type { SlugValidation } from "../../model/dataset-slug-validation.ts";
import { CopyValueButton } from "../elements/copy-value-button.tsx";
import { SlugChangeWarningAlert } from "../elements/slug-change-warning-alert.tsx";
import { SlugConflictAlert } from "../elements/slug-conflict-alert.tsx";

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

  const conflictsWith = slugInfo?.hasConflict ? slugInfo.conflictsWith : undefined;
  const warnsAboutChange = !slugInfo?.hasConflict && slugWillChange;
  const changeAlert = warnsAboutChange ? <SlugChangeWarningAlert /> : null;
  const alert = conflictsWith ? <SlugConflictAlert conflictsWith={conflictsWith} /> : changeAlert;

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
