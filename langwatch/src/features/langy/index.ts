/**
 * Langy feature module (ADR-046 frontend).
 *
 * The UI layer over the event-sourced Langy backend, modelled on
 * `features/traces-v2`:
 *   - `data/`   — slim tRPC query hooks (list / detail / messages / newCount),
 *                 the pure-query + side-effect split, and the DTO surface.
 *   - `hooks/`  — the real-time coordinator (`useLangyFreshness`), its SSE
 *                 listener, the global shortcut, and the turn-signals seam.
 *   - `stores/` — SSE/adaptive-poll status + composer context chips (zustand).
 *   - `logic/`  — the domain-error explainer.
 *   - `components/` — the badge, panel, integrated composer, streaming reveal,
 *                 number ticker, status line, error card, feedback, GitHub cards.
 *
 * The public mount surface is `ProjectLangyLayout` + `LangyContext`.
 */
export { default as ProjectLangyLayout } from "./ProjectLangyLayout";
export {
  LangyProvider,
  useLangy,
  useRegisterLangyHandlers,
} from "./LangyContext";

export { useLangyConversationList } from "./data/useLangyConversationList";
export { useLangyConversationListQuery } from "./data/useLangyConversationListQuery";
export { useLangyConversationDetail } from "./data/useLangyConversationDetail";
export { useLangyMessages } from "./data/useLangyMessages";
export { useLangyNewCount } from "./data/useLangyNewCount";
export { useLangyFeedback } from "./data/useLangyFeedback";

export { useLangyFreshness } from "./hooks/useLangyFreshness";
export { useLangyTurnSignals } from "./hooks/useLangyTurnSignals";

export { LangyError } from "./components/LangyError";
export { LangyFeedback } from "./components/LangyFeedback";
export { NumberTicker } from "./components/NumberTicker";
export { StreamingText } from "./components/StreamingText";
export { StreamingStatusLine } from "./components/StreamingStatusLine";

export {
  explainLangyError,
  readLangyStreamError,
  readLangyTrpcError,
  KNOWN_LANGY_ERROR_KINDS,
  type LangyErrorPresentation,
  type LangyDomainError,
} from "./logic/langyErrorExplainer";

export type {
  LangyConversationListItemDto,
  LangyConversationDetailDto,
  LangyConversationStatus,
  LangyMessageDto,
} from "./data/langy.dtos";
