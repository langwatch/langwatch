import {
  langyConversationStatusSchema,
  type LangyConversationDetail,
  type LangyConversationDetailDto,
  type LangyConversationListItem,
  type LangyConversationListItemDto,
} from "@langwatch/langy-contract";

export function toListItemDto(item: LangyConversationListItem): LangyConversationListItemDto {
  return {
    id: item.id,
    title: item.title,
    isShared: item.isShared,
    isOwn: item.isOwn,
    origin: item.origin,
    messageCount: item.messageCount,
    lastActivityAtMs: item.lastActivityAt.epochMilliseconds,
  };
}

/** The fold status is a free string column: an unexpected value reads as active. */
export function toDetailDto(detail: LangyConversationDetail): LangyConversationDetailDto {
  return {
    ...toListItemDto(detail),
    status: langyConversationStatusSchema.catch("active").parse(detail.status),
  };
}

export function isPart(part: unknown): part is Record<string, unknown> {
  return typeof part === "object" && part !== null && !Array.isArray(part);
}
