/**
 * API procedures and hooks: segment names (organization/project/governance) are
 * router paths and React Query cache keys; hand-written, meant to be generated.
 */

import { createModuleApi } from "@langwatch/api/web";
import type { ProjectHostOrganization, ProjectHostProject } from "../model/project-host.ts";

export type ProjectApiMap = {
  organization: {
    /**
     * Application shell's organization graph; also defaults for forms; refetched
     * after save.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: (ProjectHostOrganization & {
            slug: string;
            teams: {
              id: string;
              name: string;
              projects: ProjectHostProject[];
            }[];
          })[];
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
export const projectApi = createModuleApi<ProjectApiMap>();

/** The alias the screen moved with: `api.organization.update…`, unchanged. */
export const api = projectApi;
