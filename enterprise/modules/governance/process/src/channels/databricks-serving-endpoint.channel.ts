// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A platform refused a kill switch call. `code` is stable (`http_404`, `ThrottlingException`) and
 * is what the stop records; the message goes to the log only.
 */
export class KillSwitchPlatformError extends Error {
  readonly code: string;

  constructor({ code, message }: { code: string; message: string }) {
    super(message);
    this.name = "KillSwitchPlatformError";
    this.code = code;
  }
}

/** Stopping and starting a Databricks model serving endpoint through its workspace. */
export interface DatabricksServingEndpointChannel {
  /** POST `/api/2.0/serving-endpoints/{name}/config:stop`; throws `KillSwitchPlatformError`. */
  stopEndpoint(args: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
    signal?: AbortSignal;
  }): Promise<void>;
  /** POST `/api/2.0/serving-endpoints/{name}/config:start`; throws `KillSwitchPlatformError`. */
  startEndpoint(args: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
    signal?: AbortSignal;
  }): Promise<void>;
}
