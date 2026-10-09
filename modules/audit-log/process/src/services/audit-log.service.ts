import {
  findAuditLogByTargetKindInputSchema,
  recordAuditLogCommandSchema,
  type AuditLogHistoryEntry,
  type AuditLogTargetEntry,
  type FindAuditLogByTargetKindInput,
  type AuditLogJsonValue,
  type ListAuditLogEntityHistoryInput,
  type RecordAuditLogCommand,
  type RecordedAuditLogEntry,
  type RecordedSinceInput,
} from "@langwatch/audit-log-contract";
import { parse } from "@langwatch/ksuid";

import type { AuditLogRepository } from "../repositories/audit-log.repository.ts";

const AUDIT_KEY_RESOURCE = "audit";

const TRUNCATION_LENGTHS = [2048, 1024, 512, 256, 128] as const;

/** Stems (lowercase, letters only) that mark a key's value as secret wherever they appear. */
const SECRET_KEY_STEMS = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "privatekey",
  "signingkey",
  "encryptionkey",
  "backupcode",
  "authorization",
  "cookie",
  "credential",
  "hash",
] as const;

/** Last words that name, count or date a secret rather than carry it (apiKeyId, secretName). */
const DESCRIBING_LAST_WORDS = new Set([
  "id",
  "ids",
  "name",
  "names",
  "count",
  "type",
  "kind",
  "at",
]);

const REDACTED = "[redacted]";

export class AuditLogService {
  private constructor(
    private readonly repository: AuditLogRepository,
    private readonly maxArgsBytes: number,
  ) {}

  static create({
    repository,
    maxArgsBytes,
  }: {
    repository: AuditLogRepository;
    maxArgsBytes: number;
  }): AuditLogService {
    return new AuditLogService(repository, maxArgsBytes);
  }

  async record(command: RecordAuditLogCommand): Promise<RecordedAuditLogEntry> {
    const { idempotencyKey, ...parsed } = recordAuditLogCommandSchema.parse(command);
    const entry = {
      ...parsed,
      args:
        parsed.args === undefined
          ? undefined
          : AuditLogService.boundJson(AuditLogService.redact(parsed.args), this.maxArgsBytes),
      metadata: parsed.metadata === undefined ? undefined : AuditLogService.redact(parsed.metadata),
    };
    if (idempotencyKey === undefined) return this.repository.create(entry);
    // The key was minted when the producer committed, so the row keeps the action's moment.
    const key = parse(idempotencyKey);
    if (key.resource !== AUDIT_KEY_RESOURCE) {
      throw new Error(`an audit idempotency key is an "${AUDIT_KEY_RESOURCE}" KSUID`);
    }
    return this.repository.createOnce({ entry, idempotencyKey, occurredAt: key.date.getTime() });
  }

  /** Who, what and which target stay; only secret-bearing values are replaced. */
  private static redact(value: AuditLogJsonValue): AuditLogJsonValue {
    if (Array.isArray(value)) {
      return value.map((item) => AuditLogService.redact(item));
    }

    if (value === null || typeof value !== "object") {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        AuditLogService.isSecretEntry({ key, value: item })
          ? REDACTED
          : AuditLogService.redact(item),
      ]),
    );
  }

  private static isSecretEntry({ key, value }: { key: string; value: AuditLogJsonValue }): boolean {
    if (value === null || typeof value === "boolean") return false;
    const words = key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const lastWord = words.at(-1);
    if (lastWord !== undefined && DESCRIBING_LAST_WORDS.has(lastWord)) return false;
    const letters = words.join("").replace(/[^a-z]/g, "");
    // An LLM token count (maxTokens, prompt_tokens) is a number, never a credential.
    if (typeof value === "number" && letters.includes("tokens")) return false;
    return SECRET_KEY_STEMS.some((stem) => letters.includes(stem));
  }

  listEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]> {
    return this.repository.findEntityHistory(input);
  }

  hasRecordedSince(input: RecordedSinceInput): Promise<boolean> {
    return this.repository.hasRecordedSince(input);
  }

  async findByTargetKind(input: FindAuditLogByTargetKindInput): Promise<AuditLogTargetEntry[]> {
    return this.repository.findByTargetKind(findAuditLogByTargetKindInputSchema.parse(input));
  }

  private static truncateString(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
  }

  private static truncateValue(
    value: AuditLogJsonValue,
    maxStringLength: number,
  ): AuditLogJsonValue {
    if (typeof value === "string") {
      return AuditLogService.truncateString(value, maxStringLength);
    }

    if (Array.isArray(value)) {
      return value.map((item) => AuditLogService.truncateValue(item, maxStringLength));
    }

    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          AuditLogService.truncateValue(item, maxStringLength),
        ]),
      );
    }

    return value;
  }

  private static boundJson(value: AuditLogJsonValue, maxBytes: number): AuditLogJsonValue {
    if (JSON.stringify(value).length <= maxBytes) {
      return value;
    }

    for (const length of TRUNCATION_LENGTHS) {
      const candidate = AuditLogService.truncateValue(value, length);
      if (JSON.stringify(candidate).length <= maxBytes) {
        return candidate;
      }
    }

    return { "...": "[truncated]" };
  }
}
