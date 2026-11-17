/**
 * The gallery's reads and its one write. A refusal goes to the shared error toast, which leaves
 * a plan limit to the upgrade message the global handler already opened.
 * @see modules/scenario/specs/suite-template-gallery.feature
 */

import { showErrorToast } from "@langwatch/browser-host/errors";
import { scenarioClient } from "@langwatch/scenario-client";
import type { AppliedSuiteTemplate, SuiteTemplate } from "@langwatch/suite-contract";
import { useEffect, useRef } from "react";

import { api } from "../../../../behavior/scenario-api.ts";
import type { SuiteTemplateCreateRequest } from "./use-suite-template-wizard.ts";

export type SuiteTemplateGalleryModel = {
  templates: SuiteTemplate[] | undefined;
  isLoading: boolean;
  loadFailed: boolean;
  retry: () => void;
  isCreating: boolean;
  create: (request: SuiteTemplateCreateRequest) => void;
};

export const TEMPLATE_CREATE_FAILED = "Couldn't create the test suite from the template";

export function useSuiteTemplateGallery({
  projectId,
  onCreated,
}: {
  projectId: string | undefined;
  /** Runs once the new suite is in the rail's list, to open it. */
  onCreated: (applied: AppliedSuiteTemplate) => void;
}): SuiteTemplateGalleryModel {
  const utils = api.useUtils();
  const scenarioUtils = scenarioClient.useUtils();
  // A create that lands after the dialog closed must not open the new suite.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const templates = api.suites.testSuites.listTemplates.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  const apply = api.suites.testSuites.applyTemplate.useMutation({
    onSuccess: async (applied) => {
      if (projectId) {
        void scenarioUtils.scenarios.getAll.invalidate({ projectId });
        await utils.suites.testSuites.getAll.invalidate({ projectId });
      }
      if (isMounted.current) onCreated(applied);
    },
    onError: (error: unknown) => showErrorToast({ error, fallbackTitle: TEMPLATE_CREATE_FAILED }),
  });

  return {
    templates: templates.data,
    isLoading: templates.isLoading,
    loadFailed: !!templates.error,
    retry: () => void templates.refetch(),
    isCreating: apply.isPending,
    create: (request) => {
      if (!projectId) return;
      apply.mutate({ projectId, ...request });
    },
  };
}
