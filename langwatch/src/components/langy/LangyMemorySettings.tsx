import {
  Box,
  Button,
  HStack,
  Heading,
  IconButton,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { LuDownload, LuRefreshCw, LuTrash2, LuTriangle } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { toaster } from "~/components/ui/toaster";

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

interface ProjectMemoryDTO {
  id: string;
  projectId: string;
  content: string;
  contentVersion: number;
  refreshedAt: string;
  updatedAt: string;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  lastActivityAt: string;
}

function isStale(memory: ProjectMemoryDTO | null): boolean {
  if (!memory) return false;
  const refreshed = new Date(memory.refreshedAt).getTime();
  if (Number.isNaN(refreshed)) return false;
  return Date.now() - refreshed > STALE_THRESHOLD_MS;
}

function reportError(message: string) {
  toaster.create({
    title: "Langy memory",
    description: message,
    type: "error",
    duration: 5000,
    meta: { closable: true },
  });
}

function reportSuccess(message: string) {
  toaster.create({
    title: "Langy memory",
    description: message,
    type: "success",
    duration: 3000,
    meta: { closable: true },
  });
}

export function LangyMemorySettings() {
  const { project, hasPermission } = useOrganizationTeamProject();
  const projectId = project?.id;
  const isAdmin = hasPermission("project:manage");

  const [memory, setMemory] = useState<ProjectMemoryDTO | null>(null);
  const [draft, setDraft] = useState("");
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const loadMemory = useCallback(async () => {
    if (!projectId) return;
    setIsLoadingMemory(true);
    try {
      const res = await fetch(
        `/api/langy/project-memory?projectId=${encodeURIComponent(projectId)}`,
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { memory: ProjectMemoryDTO | null };
      setMemory(data.memory);
      setDraft(data.memory?.content ?? "");
    } catch {
      reportError("Failed to load project memory.");
    } finally {
      setIsLoadingMemory(false);
    }
  }, [projectId]);

  const loadConversations = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(
        `/api/langy/conversations?projectId=${encodeURIComponent(projectId)}`,
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as {
        conversations: ConversationSummary[];
      };
      setConversations(data.conversations);
    } catch {
      reportError("Failed to load conversations.");
    }
  }, [projectId]);

  useEffect(() => {
    void loadMemory();
    void loadConversations();
  }, [loadMemory, loadConversations]);

  const save = async () => {
    if (!projectId || !isAdmin) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/langy/project-memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, content: draft }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { memory: ProjectMemoryDTO };
      setMemory(data.memory);
      setDraft(data.memory.content);
      reportSuccess("Project memory saved.");
    } catch {
      reportError("Failed to save project memory.");
    } finally {
      setIsSaving(false);
    }
  };

  const refresh = async () => {
    if (!projectId || !isAdmin) return;
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/langy/project-memory/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { memory: ProjectMemoryDTO };
      setMemory(data.memory);
      setDraft(data.memory.content);
      reportSuccess("Project memory refreshed.");
    } catch {
      reportError("Failed to refresh project memory.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const deleteConversation = async (id: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(
        `/api/langy/conversations/${id}?projectId=${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch {
      reportError("Failed to delete conversation.");
    }
  };

  const clearAll = async () => {
    if (!projectId) return;
    setIsClearing(true);
    try {
      const res = await fetch(
        `/api/langy/memory?projectId=${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setConversations([]);
      reportSuccess("All Langy memory cleared for this project.");
    } catch {
      reportError("Failed to clear memory.");
    } finally {
      setIsClearing(false);
      setConfirmingClear(false);
    }
  };

  const exportData = async () => {
    if (!projectId) return;
    setIsExporting(true);
    try {
      const res = await fetch(
        `/api/langy/memory/export?projectId=${encodeURIComponent(projectId)}`,
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      // jsdom test env: just produce a Blob URL when supported; downstream
      // wiring to <a download> is best-effort in tests.
      if (typeof window !== "undefined" && typeof window.URL?.createObjectURL === "function") {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `langy-memory-${projectId}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      }
      reportSuccess("Export downloaded.");
    } catch {
      reportError("Failed to export memory.");
    } finally {
      setIsExporting(false);
    }
  };

  if (!projectId) return null;

  return (
    <VStack gap={6} width="full" align="stretch" paddingBottom={12}>
      <VStack gap={1} align="start">
        <Heading as="h2" size="lg">
          Langy memory
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          Manage what Langy remembers about this project and your conversations.
        </Text>
      </VStack>

      {/* Project memory editor */}
      <VStack gap={3} align="stretch">
        <HStack justify="space-between">
          <Heading as="h3" size="md">
            Project memory
          </Heading>
          {isLoadingMemory && <Spinner size="xs" />}
        </HStack>

        {isStale(memory) && (
          <HStack
            background="orange.subtle"
            color="orange.fg"
            paddingX={3}
            paddingY={2}
            borderRadius="md"
            gap={2}
          >
            <LuTriangle size={14} />
            <Text fontSize="sm">
              This memory is over 30 days old. Consider refreshing it from the
              current project state.
            </Text>
          </HStack>
        )}

        <Textarea
          aria-label="Project memory"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={10}
          readOnly={!isAdmin}
          placeholder={
            memory ? undefined : "No project memory yet — refresh to generate it."
          }
        />
        <HStack gap={2}>
          <Button
            colorPalette="blue"
            onClick={() => void save()}
            disabled={!isAdmin || isSaving}
            loading={isSaving}
          >
            Save
          </Button>
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={!isAdmin || isRefreshing}
            loading={isRefreshing}
          >
            <LuRefreshCw size={14} />
            Refresh from project
          </Button>
          {!isAdmin && (
            <Text fontSize="xs" color="fg.muted">
              Project admins can edit and refresh.
            </Text>
          )}
        </HStack>
      </VStack>

      {/* Privacy controls */}
      <VStack gap={3} align="stretch">
        <Heading as="h3" size="md">
          Your conversations
        </Heading>
        {conversations.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            No Langy conversations yet in this project.
          </Text>
        ) : (
          <Box
            as="ul"
            aria-label="Your conversations"
            listStyleType="none"
            margin={0}
            padding={0}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
          >
            {conversations.map((conv) => (
              <Box
                as="li"
                key={conv.id}
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                paddingX={3}
                paddingY={2}
                borderBottomWidth="1px"
                borderColor="border.muted"
                _last={{ borderBottomWidth: 0 }}
              >
                <Text fontSize="sm">{conv.title ?? "Untitled"}</Text>
                <IconButton
                  size="xs"
                  variant="ghost"
                  aria-label="Delete"
                  onClick={() => void deleteConversation(conv.id)}
                >
                  <LuTrash2 size={12} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}

        <HStack gap={2}>
          {confirmingClear ? (
            <>
              <Button
                colorPalette="red"
                onClick={() => void clearAll()}
                disabled={isClearing}
                loading={isClearing}
              >
                Confirm clear
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmingClear(false)}
                disabled={isClearing}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              colorPalette="red"
              variant="outline"
              onClick={() => setConfirmingClear(true)}
            >
              <LuTrash2 size={14} />
              Clear all my memory
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => void exportData()}
            disabled={isExporting}
            loading={isExporting}
          >
            <LuDownload size={14} />
            Download my data
          </Button>
        </HStack>
      </VStack>
    </VStack>
  );
}
