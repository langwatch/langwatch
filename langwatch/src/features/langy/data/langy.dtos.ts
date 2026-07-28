/**
 * Client-facing Langy DTO types.
 *
 * Re-exported (type-only) from the server-side per-use-case Zod schemas so the
 * feature module has one import surface for the wire shapes and can never drift
 * from the router's output. Mirrors how traces-v2 consumes `tracesV2.schemas`.
 */
export type {
  LangyConversationListItemDto,
  LangyConversationDetailDto,
  LangyConversationStatus,
  LangyMessageDto,
  LangyMessageDtoRole,
  LangyConversationUpdateSignal,
} from "~/server/api/routers/langy.schemas";
