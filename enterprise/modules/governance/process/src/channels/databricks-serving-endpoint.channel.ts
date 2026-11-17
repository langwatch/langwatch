// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** Stopping and starting a Databricks model serving endpoint through its workspace. */
export interface DatabricksServingEndpointChannel {
  /** POST `/api/2.0/serving-endpoints/{name}/config:stop`; throws `KillSwitchPlatformError`. */
  stopEndpoint(args: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
    signal?: AbortSignal;
  }): Promise<void>;
  /** GET `/api/2.0/serving-endpoints/{name}`: resolves when it exists, else throws (`http_404`). */
  checkEndpoint(args: {
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
