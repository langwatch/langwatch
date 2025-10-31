import { useState, useEffect, useRef } from "react";
import { useDebouncedCallback } from "use-debounce";
import { api } from "../../utils/api";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

const DEBOUNCE_TIME = 500;
const MAX_WAIT_TIME = 1000;
const LEADING = true;
const TRAILING = true;

interface UseDatasetSlugValidationProps {
  name: string;
  datasetId?: string;
}

/**
 * Result of dataset slug validation.
 *
 * @property slug - The computed slug for the dataset name
 * @property hasConflict - Whether this slug conflicts with an existing dataset
 * @property conflictsWith - Name of the conflicting dataset (if any)
 */
export type SlugValidationResult = {
  slug: string;
  hasConflict: boolean;
  conflictsWith?: string;
} | null;

/**
 * Custom hook for dataset slug validation.
 * Fully self-contained: fetches project context, dataset from DB, and manages all slug state.
 *
 * Single Responsibility: Encapsulates all slug validation logic and state management.
 *
 * @param name - Current dataset name being validated
 * @param datasetId - Current dataset ID (for edit mode, fetches slug from DB)
 * @returns Validation state and computed display values
 */
export function useDatasetSlugValidation({
  name,
  datasetId,
}: UseDatasetSlugValidationProps) {
  const [slugInfo, setSlugInfo] = useState<SlugValidationResult>(null);
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  /**
   * Request token to prevent race conditions.
   * Incremented before each API call; responses only update state if their token matches the latest.
   */
  const requestTokenRef = useRef(0);

  // Fetch existing dataset slug from DB if editing
  const { data: existingDataset } = api.dataset.getById.useQuery(
    {
      projectId: projectId ?? "",
      datasetId: datasetId ?? "",
    },
    {
      enabled: !!datasetId && !!projectId,
    }
  );

  const dbSlug = existingDataset?.slug;

  // API query for slug validation
  const validateDatasetName = api.dataset.validateDatasetName.useQuery(
    {
      projectId: projectId ?? "",
      proposedName: name,
      excludeDatasetId: datasetId,
    },
    {
      enabled: false, // Manual trigger only
    }
  );

  // Debounced validation check (500ms)
  const debouncedSlugCheck = useDebouncedCallback(() => {
    if (name && name.trim() !== "" && projectId) {
      // Increment token before making the request to invalidate any previous pending responses
      requestTokenRef.current += 1;
      const currentToken = requestTokenRef.current;

      validateDatasetName.refetch().then((result) => {
        // Only update state if this response is from the most recent request (race condition prevention)
        if (currentToken === requestTokenRef.current && result.data) {
          setSlugInfo({
            slug: result.data.slug,
            hasConflict: !result.data.available,
            conflictsWith: result.data.conflictsWith,
          });
        }
      });
    }
  }, DEBOUNCE_TIME, {
    leading: LEADING,
    trailing: TRAILING,
    maxWait: MAX_WAIT_TIME,
  });

  // Trigger validation when name changes
  useEffect(() => {
    if (name && name.trim() !== "") {
      debouncedSlugCheck();
    } else {
      setSlugInfo(null);
      debouncedSlugCheck.cancel();
      // Invalidate any pending responses when clearing the name
      requestTokenRef.current += 1;
    }

    return () => {
      debouncedSlugCheck.cancel();
      // Invalidate any pending responses on unmount
      requestTokenRef.current += 1;
    };
  }, [name, debouncedSlugCheck]);

  // Computed display values
  const displaySlug = datasetId
    ? (dbSlug && slugInfo?.slug === undefined ? dbSlug : slugInfo?.slug)
    : slugInfo?.slug;

  const slugWillChange = !!datasetId &&
                         !!dbSlug &&
                         !!slugInfo?.slug &&
                         dbSlug !== slugInfo.slug;

  return {
    /**
     * The validation result from the backend API.
     * @type {SlugValidationResult}
     */
    slugInfo,
    /**
     * The slug to display in the UI (either from DB or computed).
     * @type {string}
     */
    displaySlug,
    /**
     * Whether the slug will change when the dataset is saved.
     * @type {boolean}
     */
    slugWillChange,
    /**
     * The current slug stored in the database.
     * @type {string}
     */
    dbSlug,
    /**
     * Function to reset the slug validation state.
     * @type {() => void}
     */
    resetSlugInfo: () => setSlugInfo(null),
  };
}

