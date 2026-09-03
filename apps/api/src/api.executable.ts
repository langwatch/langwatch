import { ApiRuntimeBootstrap, type ApiRuntimeBootstrapOptions } from "./api.main";

/** Reports a fatal boot failure at the process boundary without coupling boot to Node globals. */
export abstract class ApiBootFailurePort {
  abstract report(error: unknown): void;
}

export type ApiExecutableOptions = ApiRuntimeBootstrapOptions & {
  failures?: ApiBootFailurePort;
};

/**
 * Starts the physical API process from an already selected configuration
 * source and a complete composition graph. A failed readiness/listener start
 * still closes the graph; its original error remains the reported failure.
 */
export async function startApiExecutable(
  options: ApiExecutableOptions,
): Promise<ApiRuntimeBootstrap> {
  let runtime: ApiRuntimeBootstrap | undefined;

  try {
    runtime = await ApiRuntimeBootstrap.create(options);
    await runtime.start();
    return runtime;
  } catch (error) {
    if (runtime) {
      try {
        await runtime.close();
      } catch (closeError) {
        options.failures?.report(closeError);
      }
    }
    options.failures?.report(error);
    throw error;
  }
}
