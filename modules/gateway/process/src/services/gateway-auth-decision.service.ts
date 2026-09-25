import { createLogger, type Logger } from "@langwatch/observability";

export type GatewayAuthDecision = {
  request: Request | string | undefined;
  code: string;
  status: number;
  detail?: Record<string, unknown>;
};

/** Records every gateway-internal authentication refusal on the process logger. */
export class GatewayAuthDecisionService {
  private constructor(private readonly logger: Logger) {}

  static create({ logger }: { logger?: Logger } = {}): GatewayAuthDecisionService {
    return new GatewayAuthDecisionService(logger ?? createLogger("langwatch:gateway-internal"));
  }

  record({ request, code, status, detail }: GatewayAuthDecision): void {
    this.logger.warn(
      {
        code,
        status,
        path:
          request instanceof Request
            ? new URL(request.url).pathname
            : "/api/internal/gateway/resolve-key",
        gatewayNodeId:
          (request instanceof Request
            ? request.headers.get("X-LangWatch-Gateway-Node")
            : request) ?? null,
        ...detail,
      },
      `gateway-internal auth: ${code}`,
    );
  }
}
