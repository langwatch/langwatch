import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { CreateOAuth2TokenWithIAMRequest, CreateOAuth2TokenWithIAMResponse } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link CreateOAuth2TokenWithIAMCommand}.
 */
export interface CreateOAuth2TokenWithIAMCommandInput extends CreateOAuth2TokenWithIAMRequest {
}
/**
 * @public
 *
 * The output of {@link CreateOAuth2TokenWithIAMCommand}.
 */
export interface CreateOAuth2TokenWithIAMCommandOutput extends CreateOAuth2TokenWithIAMResponse, __MetadataBearer {
}
declare const CreateOAuth2TokenWithIAMCommand_base: {
    new (input: CreateOAuth2TokenWithIAMCommandInput): import("@smithy/core/client").CommandImpl<CreateOAuth2TokenWithIAMCommandInput, CreateOAuth2TokenWithIAMCommandOutput, import("..").SigninClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (input: CreateOAuth2TokenWithIAMCommandInput): import("@smithy/core/client").CommandImpl<CreateOAuth2TokenWithIAMCommandInput, CreateOAuth2TokenWithIAMCommandOutput, import("..").SigninClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * Grants permission to exchange client credentials for an OAuth 2.0 access token
 * scoped to a resource that can be used to access AWS services from applications
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { SigninClient, CreateOAuth2TokenWithIAMCommand } from "@aws-sdk/client-signin"; // ES Modules import
 * // const { SigninClient, CreateOAuth2TokenWithIAMCommand } = require("@aws-sdk/client-signin"); // CommonJS import
 * // import type { SigninClientConfig } from "@aws-sdk/client-signin";
 * const config = {}; // type is SigninClientConfig
 * const client = new SigninClient(config);
 * const input = { // CreateOAuth2TokenWithIAMRequest
 *   grantType: "STRING_VALUE", // required
 *   resource: "STRING_VALUE", // required
 * };
 * const command = new CreateOAuth2TokenWithIAMCommand(input);
 * const response = await client.send(command);
 * // { // CreateOAuth2TokenWithIAMResponse
 * //   accessToken: "STRING_VALUE", // required
 * //   tokenType: "STRING_VALUE", // required
 * //   expiresIn: Number("int"), // required
 * // };
 *
 * ```
 *
 * @param CreateOAuth2TokenWithIAMCommandInput - {@link CreateOAuth2TokenWithIAMCommandInput}
 * @returns {@link CreateOAuth2TokenWithIAMCommandOutput}
 * @see {@link CreateOAuth2TokenWithIAMCommandInput} for command's `input` shape.
 * @see {@link CreateOAuth2TokenWithIAMCommandOutput} for command's `response` shape.
 * @see {@link SigninClientResolvedConfig | config} for SigninClient's `config` shape.
 *
 * @throws {@link AccessDeniedException} (client fault)
 *  Error thrown for access denied scenarios with flexible HTTP status mapping
 *
 * Runtime HTTP Status Code Mapping:
 * - HTTP 401 (Unauthorized): TOKEN_EXPIRED, AUTHCODE_EXPIRED
 * - HTTP 403 (Forbidden): USER_CREDENTIALS_CHANGED, INSUFFICIENT_PERMISSIONS
 *
 * The specific HTTP status code is determined at runtime based on the error enum value.
 * Consumers should use the error field to determine the specific access denial reason.
 *
 * @throws {@link InternalServerException} (server fault)
 *  Error thrown when an internal server error occurs
 *
 * HTTP Status Code: 500 Internal Server Error
 *
 * Used for unexpected server-side errors that prevent request processing.
 *
 * @throws {@link TooManyRequestsError} (client fault)
 *  Error thrown when rate limit is exceeded
 *
 * HTTP Status Code: 429 Too Many Requests
 *
 * Possible OAuth2ErrorCode values:
 * - INVALID_REQUEST: Rate limiting, too many requests, abuse prevention
 *
 * Possible causes:
 * - Too many token requests from the same client
 * - Rate limiting based on client_id or IP address
 * - Abuse prevention mechanisms triggered
 * - Service protection against excessive token generation
 *
 * @throws {@link ValidationException} (client fault)
 *  Error thrown when request validation fails
 *
 * HTTP Status Code: 400 Bad Request
 *
 * Used for request validation errors such as malformed parameters,
 * missing required fields, or invalid parameter values.
 *
 * @throws {@link SigninServiceException}
 * <p>Base exception class for all service exceptions from Signin service.</p>
 *
 *
 * @public
 */
export declare class CreateOAuth2TokenWithIAMCommand extends CreateOAuth2TokenWithIAMCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: CreateOAuth2TokenWithIAMRequest;
            output: CreateOAuth2TokenWithIAMResponse;
        };
        sdk: {
            input: CreateOAuth2TokenWithIAMCommandInput;
            output: CreateOAuth2TokenWithIAMCommandOutput;
        };
    };
}
