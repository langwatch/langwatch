import {
  type ClickHouseClientResolver,
  getClickHouseClientForProject,
} from "~/server/clickhouse/clickhouseClient";

export type MessageRole = "user" | "assistant" | "tool" | "system";

export type LangyMessageRow = {
  id: string;
  role: MessageRole;
  parts: unknown;
  createdAt: Date;
};

/**
 * Display shape the UI consumes when restoring a conversation. The raw row
 * stores `parts` (JSON string); the UI only renders text, so we flatten the
 * text parts into `content` here rather than leaking the blob.
 */
export type LangyMessageRecord = {
  id: string;
  role: MessageRole;
  content: string;
};

export function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) =>
      p && typeof (p as { text?: unknown }).text === "string"
        ? (p as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

const TABLE_NAME = "langy_messages" as const;

/**
 * Read-only repository over the `langy_messages` ClickHouse table (ADR-046).
 *
 * Writes are no longer done here — a Langy message row is now produced by the
 * `langyMessageStorage` MAP PROJECTION when a `message_sent` / `turn_finalized`
 * event is folded. This repository only reads back the projected rows.
 */
export class LangyMessageRepository {
  constructor(private readonly resolver: ClickHouseClientResolver) {}

  async findAllByConversation({
    conversationId,
    projectId,
  }: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessageRow[]> {
    const client = await this.resolver(projectId);
    // TenantId-first, IN-tuple dedup on (TenantId, ConversationId, MessageId)
    // keeping the latest UpdatedAt — never FINAL (CLAUDE.md ClickHouse rules).
    const result = await client.query({
      query: `
        SELECT MessageId, Role, Parts, CreatedAt
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND ConversationId = {conversationId:String}
          AND (TenantId, ConversationId, MessageId, UpdatedAt) IN (
            SELECT TenantId, ConversationId, MessageId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND ConversationId = {conversationId:String}
            GROUP BY TenantId, ConversationId, MessageId
          )
        ORDER BY CreatedAt ASC, MessageId ASC
      `,
      query_params: { tenantId: projectId, conversationId },
      format: "JSONEachRow",
    });
    const rows = await result.json<{
      MessageId: string;
      Role: string;
      Parts: string;
      CreatedAt: string;
    }>();
    return rows.map((r) => ({
      id: r.MessageId,
      role: r.Role as MessageRole,
      parts: JSON.parse(r.Parts) as unknown,
      createdAt: new Date(r.CreatedAt),
    }));
  }
}

export class LangyMessageService {
  constructor(private readonly repository: LangyMessageRepository) {}

  static create(): LangyMessageService {
    const resolver: ClickHouseClientResolver = async (projectId) => {
      const client = await getClickHouseClientForProject(projectId);
      if (!client)
        throw new Error(
          `No ClickHouse client configured for project ${projectId}`,
        );
      return client;
    };
    return new LangyMessageService(new LangyMessageRepository(resolver));
  }

  async getAllByConversation({
    conversationId,
    projectId,
  }: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessageRow[]> {
    return await this.repository.findAllByConversation({
      conversationId,
      projectId,
    });
  }

  async getRecordsByConversation({
    conversationId,
    projectId,
  }: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessageRecord[]> {
    const rows = await this.repository.findAllByConversation({
      conversationId,
      projectId,
    });
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: extractTextFromParts(r.parts),
    }));
  }
}
