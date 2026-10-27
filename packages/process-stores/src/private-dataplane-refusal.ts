/**
 * The refusal for an organization recorded as private whose route is missing or malformed: a
 * handled 503 whose meta names the variable (never its value), logged once per process,
 * organization and kind. Spec: specs/private-dataplane/clickhouse-routing.feature.
 */
import { PrivateRouteRefusalFactory, type PrivateRouteRefusal } from "@langwatch/clickhouse-client";
import { HandledError, remediation } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";

export type PrivateDataplaneKind = "clickhouse" | "s3";

export type PrivateDataplaneRefusal = PrivateRouteRefusal & { readonly kind: PrivateDataplaneKind };

const KIND_NAMES: Record<PrivateDataplaneKind, string> = { clickhouse: "ClickHouse", s3: "S3" };

export class PrivateDataplaneUnavailableError extends HandledError {
  declare readonly code: "private_dataplane_unavailable";

  constructor({ organizationId, kind, variable, problem }: PrivateDataplaneRefusal) {
    super(
      "private_dataplane_unavailable",
      `This organization keeps its data on its own ${KIND_NAMES[kind]}, which this deployment cannot reach`,
      {
        httpStatus: 503,
        fault: "platform",
        retryable: false,
        ...remediation("private_dataplane_unavailable"),
        meta: { organizationId, kind, variable, problem },
      },
    );
    this.name = "PrivateDataplaneUnavailableError";
  }
}

/** Builds each refusal and logs the first one per organization and kind at error. */
export class PrivateDataplaneRefusals {
  private readonly reported = new Set<string>();

  private constructor(private readonly logger: Pick<Logger, "error">) {}

  static create({
    logger = createLogger("langwatch:stores:private-dataplane"),
  }: { logger?: Pick<Logger, "error"> } = {}): PrivateDataplaneRefusals {
    return new PrivateDataplaneRefusals(logger);
  }

  refuse(refusal: PrivateDataplaneRefusal): PrivateDataplaneUnavailableError {
    const { organizationId, kind, variable, problem } = refusal;
    const key = `${kind}:${organizationId}`;
    if (!this.reported.has(key)) {
      this.reported.add(key);
      this.logger.error(
        { organizationId, kind, variable, problem },
        "Private dataplane unavailable: refusing the organization's reads and writes",
      );
    }
    return new PrivateDataplaneUnavailableError(refusal);
  }

  /** The ClickHouse router's refusal, over this process's one log. */
  forClickHouse(): PrivateRouteRefusalFactory {
    return new ClickHouseRefusal(this);
  }
}

class ClickHouseRefusal extends PrivateRouteRefusalFactory {
  constructor(private readonly refusals: PrivateDataplaneRefusals) {
    super();
  }

  create(refusal: PrivateRouteRefusal): unknown {
    return this.refusals.refuse({ ...refusal, kind: "clickhouse" });
  }
}
