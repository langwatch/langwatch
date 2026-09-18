import { APIResource } from "../../../../core/resource.mjs";
import { APIPromise } from "../../../../core/api-promise.mjs";
import { RequestOptions } from "../../../../internal/request-options.mjs";
export declare class ModelPermissions extends APIResource {
    /**
     * Returns model permissions for a project.
     *
     * @example
     * ```ts
     * const projectModelPermissions =
     *   await client.admin.organization.projects.modelPermissions.retrieve(
     *     'project_id',
     *   );
     * ```
     */
    retrieve(projectID: string, options?: RequestOptions): APIPromise<ProjectModelPermissions>;
    /**
     * Updates model permissions for a project.
     *
     * @example
     * ```ts
     * const projectModelPermissions =
     *   await client.admin.organization.projects.modelPermissions.update(
     *     'project_id',
     *     { mode: 'allow_list', model_ids: ['string'] },
     *   );
     * ```
     */
    update(projectID: string, body: ModelPermissionUpdateParams, options?: RequestOptions): APIPromise<ProjectModelPermissions>;
    /**
     * Deletes model permissions for a project.
     *
     * @example
     * ```ts
     * const projectModelPermissionsDeleted =
     *   await client.admin.organization.projects.modelPermissions.delete(
     *     'project_id',
     *   );
     * ```
     */
    delete(projectID: string, options?: RequestOptions): APIPromise<ProjectModelPermissionsDeleted>;
}
/**
 * Represents the model allowlist or denylist policy for a project.
 */
export interface ProjectModelPermissions {
    /**
     * Whether the project uses an allowlist or a denylist.
     */
    mode: 'allow_list' | 'deny_list';
    /**
     * The model IDs included in the model permissions policy.
     */
    model_ids: Array<string>;
    /**
     * The object type, which is always `project.model_permissions`.
     */
    object: 'project.model_permissions';
}
/**
 * Confirmation payload returned after deleting project model permissions.
 */
export interface ProjectModelPermissionsDeleted {
    /**
     * Whether the project model permissions were deleted.
     */
    deleted: boolean;
    /**
     * The object type, which is always `project.model_permissions.deleted`.
     */
    object: 'project.model_permissions.deleted';
}
export interface ModelPermissionUpdateParams {
    /**
     * The model permissions mode to apply.
     */
    mode: 'allow_list' | 'deny_list';
    /**
     * The model IDs included in this permissions policy.
     */
    model_ids: Array<string>;
}
export declare namespace ModelPermissions {
    export { type ProjectModelPermissions as ProjectModelPermissions, type ProjectModelPermissionsDeleted as ProjectModelPermissionsDeleted, type ModelPermissionUpdateParams as ModelPermissionUpdateParams, };
}
//# sourceMappingURL=model-permissions.d.mts.map