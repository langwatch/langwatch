import { resolvePoolSize, type PoolSizingDecision, type PoolSizingInput } from "./pool";

export interface ClickHouseSharedConfiguration {
  /** The shared endpoint. Omit it only when this process has no ClickHouse work. */
  url: string;
  /** A credential-free name used by telemetry and operator messages. */
  cluster: string;
}

export interface ClickHousePrivateRouteConfiguration {
  organizationId: string;
  url: string;
  /** A credential-free operator label for this private endpoint. */
  cluster: string;
}

export interface ClickHouseConfigurationInput {
  shared?: ClickHouseSharedConfiguration | undefined;
  privateRoutes?: readonly ClickHousePrivateRouteConfiguration[] | undefined;
  poolSizing?: PoolSizingInput | undefined;
}

export interface ClickHouseConfiguration {
  shared: ClickHouseSharedConfiguration | undefined;
  privateRoutes: ReadonlyMap<string, ClickHousePrivateRouteConfiguration>;
  poolSizing: PoolSizingDecision;
}

export class DuplicatePrivateClickHouseRouteError extends Error {
  constructor(organizationId: string) {
    super(`Two ClickHouse routes are configured for organisation "${organizationId}".`);
    this.name = "DuplicatePrivateClickHouseRouteError";
  }
}

export class InvalidClickHouseConfigurationError extends Error {
  constructor(field: string) {
    super(`ClickHouse configuration field "${field}" must not be empty.`);
    this.name = "InvalidClickHouseConfigurationError";
  }
}

/** Resolves already-validated process configuration without reading ambient state. */
export class ClickHouseConfigService {
  private constructor() {}

  static create(): ClickHouseConfigService {
    return new ClickHouseConfigService();
  }

  resolve(input: ClickHouseConfigurationInput): ClickHouseConfiguration {
    const shared = input.shared;
    if (shared !== undefined) {
      this.assertNonEmpty("shared.url", shared.url);
      this.assertNonEmpty("shared.cluster", shared.cluster);
    }

    const privateRoutes = new Map<string, ClickHousePrivateRouteConfiguration>();
    for (const route of input.privateRoutes ?? []) {
      this.assertNonEmpty("privateRoutes.organizationId", route.organizationId);
      this.assertNonEmpty("privateRoutes.url", route.url);
      this.assertNonEmpty("privateRoutes.cluster", route.cluster);
      if (privateRoutes.has(route.organizationId)) {
        throw new DuplicatePrivateClickHouseRouteError(route.organizationId);
      }
      privateRoutes.set(route.organizationId, { ...route });
    }

    return {
      shared: shared === undefined ? undefined : { ...shared },
      privateRoutes,
      poolSizing: resolvePoolSize(input.poolSizing),
    };
  }

  private assertNonEmpty(field: string, value: string): void {
    if (value.trim() === "") throw new InvalidClickHouseConfigurationError(field);
  }
}
