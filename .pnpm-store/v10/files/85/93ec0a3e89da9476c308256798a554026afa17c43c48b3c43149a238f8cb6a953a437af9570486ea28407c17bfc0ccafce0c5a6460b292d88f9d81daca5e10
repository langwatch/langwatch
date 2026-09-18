import { APIResource } from "../../../core/resource.js";
import { APIPromise } from "../../../core/api-promise.js";
import { RequestOptions } from "../../../internal/request-options.js";
export declare class DataRetention extends APIResource {
    /**
     * Retrieves organization data retention controls.
     *
     * @example
     * ```ts
     * const organizationDataRetention =
     *   await client.admin.organization.dataRetention.retrieve();
     * ```
     */
    retrieve(options?: RequestOptions): APIPromise<OrganizationDataRetention>;
    /**
     * Updates organization data retention controls.
     *
     * @example
     * ```ts
     * const organizationDataRetention =
     *   await client.admin.organization.dataRetention.update({
     *     retention_type: 'zero_data_retention',
     *   });
     * ```
     */
    update(body: DataRetentionUpdateParams, options?: RequestOptions): APIPromise<OrganizationDataRetention>;
}
/**
 * Represents the organization's data retention control setting.
 */
export interface OrganizationDataRetention {
    /**
     * The object type, which is always `organization.data_retention`.
     */
    object: 'organization.data_retention';
    /**
     * The configured organization data retention type.
     */
    type: 'zero_data_retention' | 'modified_abuse_monitoring' | 'enhanced_zero_data_retention' | 'enhanced_modified_abuse_monitoring';
}
export interface DataRetentionUpdateParams {
    /**
     * The desired organization data retention type.
     */
    retention_type: 'zero_data_retention' | 'modified_abuse_monitoring' | 'enhanced_zero_data_retention' | 'enhanced_modified_abuse_monitoring';
}
export declare namespace DataRetention {
    export { type OrganizationDataRetention as OrganizationDataRetention, type DataRetentionUpdateParams as DataRetentionUpdateParams, };
}
//# sourceMappingURL=data-retention.d.ts.map