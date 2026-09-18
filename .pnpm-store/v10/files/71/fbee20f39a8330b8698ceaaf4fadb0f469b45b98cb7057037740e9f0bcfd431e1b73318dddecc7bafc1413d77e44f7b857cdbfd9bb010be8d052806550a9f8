import { APIResource } from "../../../../core/resource.js";
import { APIPromise } from "../../../../core/api-promise.js";
import { RequestOptions } from "../../../../internal/request-options.js";
export declare class DataRetention extends APIResource {
    /**
     * Retrieves project data retention controls.
     *
     * @example
     * ```ts
     * const projectDataRetention =
     *   await client.admin.organization.projects.dataRetention.retrieve(
     *     'project_id',
     *   );
     * ```
     */
    retrieve(projectID: string, options?: RequestOptions): APIPromise<ProjectDataRetention>;
    /**
     * Updates project data retention controls.
     *
     * @example
     * ```ts
     * const projectDataRetention =
     *   await client.admin.organization.projects.dataRetention.update(
     *     'project_id',
     *     { retention_type: 'organization_default' },
     *   );
     * ```
     */
    update(projectID: string, body: DataRetentionUpdateParams, options?: RequestOptions): APIPromise<ProjectDataRetention>;
}
/**
 * Represents a project's data retention control setting.
 */
export interface ProjectDataRetention {
    /**
     * The object type, which is always `project.data_retention`.
     */
    object: 'project.data_retention';
    /**
     * The configured project data retention type.
     */
    type: 'organization_default' | 'none' | 'zero_data_retention' | 'modified_abuse_monitoring' | 'enhanced_zero_data_retention' | 'enhanced_modified_abuse_monitoring';
}
export interface DataRetentionUpdateParams {
    /**
     * The desired project data retention type.
     */
    retention_type: 'organization_default' | 'none' | 'zero_data_retention' | 'modified_abuse_monitoring' | 'enhanced_zero_data_retention' | 'enhanced_modified_abuse_monitoring';
}
export declare namespace DataRetention {
    export { type ProjectDataRetention as ProjectDataRetention, type DataRetentionUpdateParams as DataRetentionUpdateParams, };
}
//# sourceMappingURL=data-retention.d.ts.map