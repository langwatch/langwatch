/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `organization`, `project` and
 * `governance` are mount points on the root router and tRPC hashes that path
 * into the React Query cache key; spell one differently and this page stops
 * sharing a cache with the application shell's own organization graph, which is
 * exactly what it refetches after a save.
 *
 * `governance.resolveHome` IS NOT THIS FEATURE'S and is invalidated rather than
 * read: changing the organization's primary use moves where `/` lands, and the
 * resolver that decides it caches its answer.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";
import type { ProjectHostOrganization, ProjectHostProject } from "../model/project-host";

export type ProjectApiMap = {
  organization: {
    /**
     * The graph the application shell already holds, refetched after a save.
     *
     * THIS IS ALSO WHERE THE FORMS GET THEIR DEFAULTS. The graph carries the
     * whole organization row and the whole project row — which is what
     * `useOrganizationTeamProject` handed the platform page — so this family
     * needs no read of its own, and the refetch after a save is what puts the
     * new values back on the page.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<
          ProjectHostOrganization & {
            slug: string;
            teams: Array<{
              id: string;
              name: string;
              projects: ProjectHostProject[];
            }>;
          }
        >;
      };
    };

    update: {
      mutation: {
        input: {
          organizationId: string;
          name: string;
          s3Endpoint: string;
          s3AccessKeyId: string;
          s3SecretAccessKey: string;
          s3Bucket: string;
          presenceEnabled: boolean;
          traceSharingEnabled: boolean;
          supportContact: string | null;
          primaryIntent: string | null;
        };
        output: Partial<ProjectHostOrganization>;
      };
    };
  };

  project: {
    update: {
      mutation: {
        input: {
          projectId: string;
          name: string;
          language: string;
          framework: string;
          userLinkTemplate: string;
          s3Endpoint: string;
          s3AccessKeyId: string;
          s3SecretAccessKey: string;
          s3Bucket: string;
          traceSharingEnabled?: boolean;
          presenceEnabled?: boolean;
        };
        output: Partial<ProjectHostProject>;
      };
    };
  };

  governance: {
    /**
     * Where `/` lands for this organization.
     *
     * Never read here — only invalidated, because the primary-use setting on
     * this page is what changes the answer.
     */
    resolveHome: {
      query: { input: Record<string, never>; output: unknown };
    };
  };
};

/** The project family's typed tRPC hooks. */
export const projectApi = createFeatureApi<ProjectApiMap>();

/** The alias the screen moved with: `api.organization.update…`, unchanged. */
export const api = projectApi;
