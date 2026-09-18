/**
 * Authentication schemes represent a way that the service will authenticate the customer’s identity.
 *
 * @internal
 */
export interface AuthScheme {
    /**
     * @example "sigv4a" or "sigv4"
     */
    name: "sigv4" | "sigv4a" | string;
    /**
     * @example "s3"
     */
    signingName: string;
    /**
     * @example "us-east-1"
     */
    signingRegion: string;
    /**
     * @example ["*"]
     * @example ["us-west-2", "us-east-1"]
     */
    signingRegionSet?: string[];
    /**
     * @deprecated this field was renamed to signingRegion.
     */
    signingScope?: never;
    properties: Record<string, unknown>;
}
/**
 * @deprecated
 *
 * @internal
 */
export interface HttpAuthDefinition {
    /**
     * Defines the location of where the Auth is serialized.
     */
    in: HttpAuthLocation;
    /**
     * Defines the name of the HTTP header or query string parameter
     * that contains the Auth.
     */
    name: string;
    /**
     * Defines the security scheme to use on the `Authorization` header value.
     * This can only be set if the "in" property is set to {@link HttpAuthLocation.HEADER}.
     */
    scheme?: string;
}
/**
 * @deprecated
 *
 * @internal
 */
export declare enum HttpAuthLocation {
    HEADER = "header",
    QUERY = "query"
}
