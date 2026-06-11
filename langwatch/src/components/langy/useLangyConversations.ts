import { useCallback, useEffect, useRef, useState } from "react";

export interface LangyConversationSummary {
  id: string;
  title: string | null;
  lastActivityAt: string;
}

export interface LangyMessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ConversationsListResponse {
  conversations: LangyConversationSummary[];
}

interface ConversationDetailResponse {
  conversation: LangyConversationSummary;
  messages: LangyMessageRecord[];
}

interface UseLangyConversationsArgs {
  projectId: string | undefined;
  setMessages: (messages: LangyMessageRecord[]) => void;
  onError: (message: string) => void;
}

function localStorageKey(projectId: string) {
  return `langy:lastConversation:${projectId}`;
}

function readLastConversationId(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(localStorageKey(projectId));
  } catch {
    return null;
  }
}

function writeLastConversationId(projectId: string, id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id === null) window.localStorage.removeItem(localStorageKey(projectId));
    else window.localStorage.setItem(localStorageKey(projectId), id);
  } catch {
    // ignore quota / disabled storage
  }
}

export interface UseLangyConversationsResult {
  conversations: LangyConversationSummary[];
  currentConversationId: string | null;
  isLoading: boolean;
  hasListError: boolean;
  select: (id: string) => Promise<void>;
  startNew: () => void;
  remove: (id: string) => Promise<void>;
  /**
   * Mark a conversation the server just created (or confirmed) as the
   * active one — without reloading its messages, which the chat stream
   * already holds. Used by the chat transport when /langy/chat returns
   * `x-langy-conversation-id`, so follow-up sends stay in the same
   * conversation instead of forking a new one per message.
   */
  adopt: (id: string) => void;
}

export function useLangyConversations({
  projectId,
  setMessages,
  onError,
}: UseLangyConversationsArgs): UseLangyConversationsResult {
  const [conversations, setConversations] = useState<LangyConversationSummary[]>(
    [],
  );
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasListError, setHasListError] = useState(false);

  // Avoid stale closures inside async flows.
  const projectIdRef = useRef<string | undefined>(projectId);
  projectIdRef.current = projectId;
  // Monotonic token so a slow in-flight load can't overwrite a newer one.
  const latestLoadTokenRef = useRef(0);

  const loadConversation = useCallback(
    async (id: string, projectIdForCall: string) => {
      const token = ++latestLoadTokenRef.current;
      const res = await fetch(
        `/api/langy/conversations/${id}?projectId=${encodeURIComponent(projectIdForCall)}`,
      );
      if (!res.ok) throw new Error(`Failed to load conversation ${id}`);
      const data = (await res.json()) as ConversationDetailResponse;
      // Drop the result if the project changed or a newer load superseded us.
      if (
        projectIdRef.current !== projectIdForCall ||
        token !== latestLoadTokenRef.current
      ) {
        return;
      }
      setCurrentConversationId(data.conversation.id);
      writeLastConversationId(projectIdForCall, data.conversation.id);
      setMessages(data.messages);
    },
    [setMessages],
  );

  useEffect(() => {
    if (!projectId) {
      setConversations([]);
      setCurrentConversationId(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    // Clear visible conversation state up front so stale messages from the
    // previous project don't linger while the new project's data loads.
    setCurrentConversationId(null);
    setMessages([]);
    setIsLoading(true);
    setHasListError(false);
    (async () => {
      try {
        const res = await fetch(
          `/api/langy/conversations?projectId=${encodeURIComponent(projectId)}`,
        );
        if (!res.ok) throw new Error(`List failed: ${res.status}`);
        const data = (await res.json()) as ConversationsListResponse;
        if (cancelled) return;
        const sorted = [...data.conversations].sort((a, b) =>
          b.lastActivityAt.localeCompare(a.lastActivityAt),
        );
        setConversations(sorted);

        // Pick the conversation to restore: last-active from localStorage if
        // still present in the list, else the most recently active one.
        const stored = readLastConversationId(projectId);
        const pick =
          (stored && sorted.find((c) => c.id === stored)?.id) ??
          sorted[0]?.id ??
          null;
        if (pick) {
          await loadConversation(pick, projectId);
        } else {
          setCurrentConversationId(null);
          setMessages([]);
        }
      } catch {
        if (cancelled) return;
        setHasListError(true);
        setConversations([]);
        onError("Failed to load Langy conversations.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, loadConversation, onError, setMessages]);

  const select = useCallback(
    async (id: string) => {
      if (!projectId) return;
      try {
        await loadConversation(id, projectId);
      } catch {
        onError("Failed to open conversation.");
      }
    },
    [projectId, loadConversation, onError],
  );

  const startNew = useCallback(() => {
    if (!projectId) return;
    setCurrentConversationId(null);
    writeLastConversationId(projectId, null);
    setMessages([]);
  }, [projectId, setMessages]);

  const adopt = useCallback(
    (id: string) => {
      const currentProjectId = projectIdRef.current;
      if (!currentProjectId) return;
      setCurrentConversationId(id);
      writeLastConversationId(currentProjectId, id);
      // Refresh the list in the background so the adopted conversation (and
      // its server-derived title) appears in the recents list. Best-effort:
      // a failure here only leaves the list slightly stale.
      void (async () => {
        try {
          const res = await fetch(
            `/api/langy/conversations?projectId=${encodeURIComponent(currentProjectId)}`,
          );
          if (!res.ok) return;
          const data = (await res.json()) as ConversationsListResponse;
          if (projectIdRef.current !== currentProjectId) return;
          setConversations(
            [...data.conversations].sort((a, b) =>
              b.lastActivityAt.localeCompare(a.lastActivityAt),
            ),
          );
        } catch {
          // ignore — recents list refresh is cosmetic
        }
      })();
    },
    [],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!projectId) return;
      const wasActive = currentConversationId === id;
      try {
        const res = await fetch(
          `/api/langy/conversations/${id}?projectId=${encodeURIComponent(projectId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (wasActive) {
          setCurrentConversationId(null);
          writeLastConversationId(projectId, null);
          setMessages([]);
        }
      } catch {
        onError("Failed to delete conversation.");
      }
    },
    [projectId, currentConversationId, setMessages, onError],
  );

  return {
    conversations,
    currentConversationId,
    isLoading,
    hasListError,
    select,
    startNew,
    remove,
    adopt,
  };
}
