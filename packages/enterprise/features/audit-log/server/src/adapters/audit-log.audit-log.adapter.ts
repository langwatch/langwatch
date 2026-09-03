import type {
  AuditLogJsonValue,
  AuditLogService,
} from "@langwatch/enterprise-audit-log-contract";
import {
  PrismaAuditLogRepository,
  type AuditLogPrismaClient,
} from "../repositories/prisma/prisma.audit-log.repository";
import { DefaultAuditLogService } from "../services/audit-log.service";

const IP_HEADERS = [
  "cf-connecting-ip",
  "x-forwarded-for",
  "x-forwarded",
  "x-real-ip",
  "x-client-ip",
  "forwarded-for",
  "forwarded",
  "true-client-ip",
  "x-cluster-client-ip",
  "fastly-client-ip",
] as const;

export type AuditLogRequestLike = {
  headers: Record<string, string | readonly string[] | undefined>;
  socket?: { remoteAddress?: string };
};

export type LegacyAuditLogInput = {
  userId: string;
  organizationId?: string;
  projectId?: string;
  action: string;
  args?: unknown;
  error?: Error;
  req?: AuditLogRequestLike;
  metadata?: AuditLogJsonValue;
  targetKind?: string;
  targetId?: string;
};

function validIp(value: string): string | undefined {
  const candidate =
    value
      .split(",")[0]
      ?.replace(/^::ffff:/, "")
      .trim() ?? "";
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(candidate)) return candidate;
  if (/^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(candidate)) return candidate;
  return undefined;
}

function clientIp(request: AuditLogRequestLike | undefined): string | undefined {
  if (!request) return undefined;
  for (const header of IP_HEADERS) {
    const raw = request.headers[header];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) {
      const ip = validIp(value);
      if (ip) return ip;
    }
  }
  return request.socket?.remoteAddress
    ? validIp(request.socket.remoteAddress)
    : undefined;
}

function jsonClone(value: unknown): AuditLogJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as AuditLogJsonValue;
}

export class AuditLogAdapter {
  private constructor(private readonly service: AuditLogService) {}

  static create(input: { prisma: unknown; maxArgsBytes?: number }): AuditLogAdapter {
    return new AuditLogAdapter(
      DefaultAuditLogService.create({
        repository: PrismaAuditLogRepository.create(input.prisma as AuditLogPrismaClient),
        maxArgsBytes: input.maxArgsBytes,
      }),
    );
  }

  static fromService(service: AuditLogService): AuditLogAdapter {
    return new AuditLogAdapter(service);
  }

  async record(input: LegacyAuditLogInput): Promise<void> {
    const userAgent = input.req?.headers["user-agent"];
    await this.service.record({
      userId: input.userId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      action: input.action,
      args: jsonClone(input.args),
      error: input.error?.toString(),
      ipAddress: clientIp(input.req),
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      metadata: input.metadata,
      targetKind: input.targetKind,
      targetId: input.targetId,
    });
  }
}
