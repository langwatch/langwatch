import { useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/surfaces/workflow-api";

const DEBOUNCE_TIME = 500;
const MAX_WAIT_TIME = 1000;
const LEADING = true;
const TRAILING = true;

interface UseDatasetSlugValidationProps {
  name: string;
  datasetId?: string;
}

/**
 * Result of dataset slug validation. @property slug - The computed slug for the dataset name
 * @property hasConflict - Whether this slug conflicts with an existing dataset @property
 * conflictsWith - Name of the conflicting dataset (if any)
 */
export type SlugValidationResult = {
  slug: string;
  hasConflict: boolean;
  conflictsWith?: string;
} | null;

/** The backend's verdict, or nothing at all when the query answered nothing. */
async function refreshSlugInfo({
  refetch,
  setSlugInfo,
}: {
  refetch: () => Promise<{
    data?: { slug: string; available: boolean; conflictsWith?: string } | undefined;
  }>;
  setSlugInfo: (info: SlugValidationResult) => void;
}): Promise<void> {
  const result = await refetch();
  if (!result.data) return;

  setSlugInfo({
    slug: result.data.slug,
    hasConflict: !result.data.available,
    conflictsWith: result.data.conflictsWith,
  });
}

/**
 * @param name - Current dataset name being validated
 * @param datasetId - Current dataset ID (for edit mode, fetches slug from DB)
 * @returns Validation state and computed display values
 */
export function useDatasetSlugValidation({ name, datasetId }: UseDatasetSlugValidationProps) {
  const [slugInfo, setSlugInfo] = useState<SlugValidationResult>(null);
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  // Fetch existing dataset slug from DB if editing
  const { data: existingDataset } = api.dataset.getById.useQuery(
    {
      projectId: projectId ?? "",
      datasetId: datasetId ?? "",
    },
    {
      enabled: !!datasetId && !!projectId,
    },
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
    },
  );

  // Debounced validation check (500ms)
  const debouncedSlugCheck = useDebouncedCallback(
    () => {
      const canValidate = Boolean(name && name.trim() !== "" && projectId);
      if (!canValidate) return;

      void refreshSlugInfo({ refetch: () => validateDatasetName.refetch(), setSlugInfo });
    },
    DEBOUNCE_TIME,
    {
      leading: LEADING,
      trailing: TRAILING,
      maxWait: MAX_WAIT_TIME,
    },
  );

  // Trigger validation when name changes
  useEffect(() => {
    const hasName = Boolean(name && name.trim() !== "");
    if (hasName) {
      debouncedSlugCheck();
    } else {
      setSlugInfo(null);
      debouncedSlugCheck.cancel();
    }

    return () => {
      debouncedSlugCheck.cancel();
    };
  }, [name, debouncedSlugCheck]);

  // Computed display values
  const keepsStoredSlug = Boolean(dbSlug) && slugInfo?.slug === undefined;
  const editedSlug = keepsStoredSlug ? dbSlug : slugInfo?.slug;
  const displaySlug = datasetId ? editedSlug : slugInfo?.slug;

  const hasBothSlugs = Boolean(datasetId) && Boolean(dbSlug) && Boolean(slugInfo?.slug);
  const slugWillChange = hasBothSlugs && dbSlug !== slugInfo?.slug;

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
