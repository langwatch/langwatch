import { APIResource } from "../../../../core/resource.js";
import { APIPromise } from "../../../../core/api-promise.js";
import { RequestOptions } from "../../../../internal/request-options.js";
export declare class HostedToolPermissions extends APIResource {
    /**
     * Returns hosted tool permissions for a project.
     *
     * @example
     * ```ts
     * const projectHostedToolPermissions =
     *   await client.admin.organization.projects.hostedToolPermissions.retrieve(
     *     'project_id',
     *   );
     * ```
     */
    retrieve(projectID: string, options?: RequestOptions): APIPromise<ProjectHostedToolPermissions>;
    /**
     * Updates hosted tool permissions for a project.
     *
     * @example
     * ```ts
     * const projectHostedToolPermissions =
     *   await client.admin.organization.projects.hostedToolPermissions.update(
     *     'project_id',
     *   );
     * ```
     */
    update(projectID: string, body: HostedToolPermissionUpdateParams, options?: RequestOptions): APIPromise<ProjectHostedToolPermissions>;
}
/**
 * Represents hosted tool permissions for a project.
 */
export interface ProjectHostedToolPermissions {
    /**
     * Permission state for a single hosted tool on a project.
     */
    code_interpreter: ProjectHostedToolPermissions.CodeInterpreter;
    /**
     * Permission state for a single hosted tool on a project.
     */
    file_search: ProjectHostedToolPermissions.FileSearch;
    /**
     * Permission state for a single hosted tool on a project.
     */
    image_generation: ProjectHostedToolPermissions.ImageGeneration;
    /**
     * Permission state for a single hosted tool on a project.
     */
    mcp: ProjectHostedToolPermissions.Mcp;
    /**
     * Permission state for a single hosted tool on a project.
     */
    web_search: ProjectHostedToolPermissions.WebSearch;
}
export declare namespace ProjectHostedToolPermissions {
    /**
     * Permission state for a single hosted tool on a project.
     */
    interface CodeInterpreter {
        /**
         * Whether the hosted tool is enabled for the project.
         */
        enabled: boolean;
    }
    /**
     * Permission state for a single hosted tool on a project.
     */
    interface FileSearch {
        /**
         * Whether the hosted tool is enabled for the project.
         */
        enabled: boolean;
    }
    /**
     * Permission state for a single hosted tool on a project.
     */
    interface ImageGeneration {
        /**
         * Whether the hosted tool is enabled for the project.
         */
        enabled: boolean;
    }
    /**
     * Permission state for a single hosted tool on a project.
     */
    interface Mcp {
        /**
         * Whether the hosted tool is enabled for the project.
         */
        enabled: boolean;
    }
    /**
     * Permission state for a single hosted tool on a project.
     */
    interface WebSearch {
        /**
         * Whether the hosted tool is enabled for the project.
         */
        enabled: boolean;
    }
}
export interface HostedToolPermissionUpdateParams {
    /**
     * The code interpreter permission update.
     */
    code_interpreter?: HostedToolPermissionUpdateParams.CodeInterpreter | null;
    /**
     * The file search permission update.
     */
    file_search?: HostedToolPermissionUpdateParams.FileSearch | null;
    /**
     * The image generation permission update.
     */
    image_generation?: HostedToolPermissionUpdateParams.ImageGeneration | null;
    /**
     * The MCP permission update.
     */
    mcp?: HostedToolPermissionUpdateParams.Mcp | null;
    /**
     * The web search permission update.
     */
    web_search?: HostedToolPermissionUpdateParams.WebSearch | null;
}
export declare namespace HostedToolPermissionUpdateParams {
    /**
     * The code interpreter permission update.
     */
    interface CodeInterpreter {
        /**
         * Whether to enable the hosted tool for the project.
         */
        enabled: boolean;
    }
    /**
     * The file search permission update.
     */
    interface FileSearch {
        /**
         * Whether to enable the hosted tool for the project.
         */
        enabled: boolean;
    }
    /**
     * The image generation permission update.
     */
    interface ImageGeneration {
        /**
         * Whether to enable the hosted tool for the project.
         */
        enabled: boolean;
    }
    /**
     * The MCP permission update.
     */
    interface Mcp {
        /**
         * Whether to enable the hosted tool for the project.
         */
        enabled: boolean;
    }
    /**
     * The web search permission update.
     */
    interface WebSearch {
        /**
         * Whether to enable the hosted tool for the project.
         */
        enabled: boolean;
    }
}
export declare namespace HostedToolPermissions {
    export { type ProjectHostedToolPermissions as ProjectHostedToolPermissions, type HostedToolPermissionUpdateParams as HostedToolPermissionUpdateParams, };
}
//# sourceMappingURL=hosted-tool-permissions.d.ts.map