import { randomUUID } from "crypto";
import {
  type ClickHouseClientResolver,
  getClickHouseClientForProject,
} from "~/server/clickhouse/clickhouseClient";

export type MessageRole = "user" | "assistant" | "tool" | "system";

export type CreateMessageInput = {
  conversationId: string;
  projectId: string;
  role: MessageRole;
  parts: unknown;
};

export type LangyMessageRow = {
  id: string;
  role: MessageRole;
  parts: unknown;
  createdAt: Date;
};

/**
 * Display shape the UI consumes when restoring a conversation. The raw
 * row stores `parts` (JSON string); the UI only renders text, so we flatten
 * the text parts into `content` here rather than leaking the blob.
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
    const result = await client.query({
      query: `
        SELECT MessageId, Role, Parts, CreatedAt
        FROM ${TABLE_NAME} FINAL
        WHERE TenantId = {tenantId:String}
          AND ConversationId = {conversationId:String}
        ORDER BY CreatedAt ASC
      `,
      query_params: { tenantId: projectId, conversationId },
    });
    const rows = await result.json<{
      MessageId: string;
      Role: string;
      Parts: string;
      CreatedAt: string;
    }>();
    return rows.data.map((r) => ({
      id: r.MessageId,
      role: r.Role as MessageRole,
      parts: JSON.parse(r.Parts) as unknown,
      createdAt: new Date(r.CreatedAt),
    }));
  }

  async create(input: CreateMessageInput): Promise<LangyMessageRow> {
    const client = await this.resolver(input.projectId);
    const messageId = randomUUID();
    const now = new Date().toISOString();
    await client.insert({
      table: TABLE_NAME,
      values: [
        {
          TenantId: input.projectId,
          ConversationId: input.conversationId,
          MessageId: messageId,
          Role: input.role,
          Parts: JSON.stringify(input.parts ?? []),
          CreatedAt: now,
          UpdatedAt: now,
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
    return {
      id: messageId,
      role: input.role,
      parts: input.parts,
      createdAt: new Date(now),
    };
  }
}

export class LangyMessageService {
  constructor(private readonly repository: LangyMessageRepository) {}

  static create(): LangyMessageService {
    const resolver: ClickHouseClientResolver = async (projectId) => {
      const client = await getClickHouseClientForProject(projectId);
      if (!client)
        throw new Error(`No ClickHouse client configured for project ${projectId}`);
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

  async append(input: CreateMessageInput): Promise<LangyMessageRow> {
    return await this.repository.create(input);
  }
}
