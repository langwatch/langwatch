/** One request a probe sends back through the deployment's own public origin. */
export interface SubsystemProbeRequest {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  /** The caller's own signal: the request that asked for the probe. */
  readonly signal: AbortSignal | undefined;
}

/** The deployment's public boundary, as the canaries reach it. */
export interface SubsystemProbeChannel {
  post(request: SubsystemProbeRequest & { readonly body: string }): Promise<Response>;
  get(request: SubsystemProbeRequest): Promise<Response>;
}
