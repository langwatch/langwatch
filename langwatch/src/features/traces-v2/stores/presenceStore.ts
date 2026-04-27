/**
 * Multiplayer Presence Store (PoC)
 * Tracks which team members are viewing which traces/spans.
 * Uses mock data for now — future: WebSocket integration.
 */
import { create } from "zustand";

export interface TeamMember {
  id: string;
  name: string;
  initials: string;
  color: string;
}

export interface PresenceEntry {
  userId: string;
  lensId: string;
  traceId: string | null;
  spanId: string | null;
  status: "active" | "idle";
  lastSeen: number;
}

interface PresenceState {
  members: TeamMember[];
  entries: PresenceEntry[];

  /** Get members viewing a specific lens */
  getMembersOnLens: (lensId: string) => TeamMember[];
  /** Get members viewing a specific trace */
  getMembersOnTrace: (traceId: string) => TeamMember[];
  /** Get members viewing a specific span */
  getMembersOnSpan: (spanId: string) => TeamMember[];
}

// Team colors (distinct from span type colors)
const TEAM_COLORS = [
  "pink.solid",
  "teal.solid",
  "cyan.solid",
  "yellow.solid",
  "purple.solid",
];

// Mock team members for PoC
const mockMembers: TeamMember[] = [
  { id: "user-sarah", name: "Sarah Chen", initials: "SC", color: TEAM_COLORS[0]! },
  { id: "user-alex", name: "Alex Kim", initials: "AK", color: TEAM_COLORS[1]! },
  { id: "user-jordan", name: "Jordan Lee", initials: "JL", color: TEAM_COLORS[2]! },
];

// Mock presence entries for PoC
const mockEntries: PresenceEntry[] = [
  {
    userId: "user-sarah",
    lensId: "all-traces",
    traceId: "trace-002",
    spanId: null,
    status: "active",
    lastSeen: Date.now() - 30_000,
  },
  {
    userId: "user-alex",
    lensId: "errors",
    traceId: "trace-006",
    spanId: "span-006-llm2",
    status: "active",
    lastSeen: Date.now() - 120_000,
  },
  {
    userId: "user-jordan",
    lensId: "all-traces",
    traceId: null,
    spanId: null,
    status: "idle",
    lastSeen: Date.now() - 300_000,
  },
];

function lookupMember(
  members: TeamMember[],
  userId: string,
): TeamMember | undefined {
  return members.find((m) => m.id === userId);
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  members: mockMembers,
  entries: mockEntries,

  getMembersOnLens: (lensId) => {
    const { members, entries } = get();
    return entries
      .filter((e) => e.lensId === lensId && e.status === "active")
      .map((e) => lookupMember(members, e.userId))
      .filter((m): m is TeamMember => m !== undefined);
  },

  getMembersOnTrace: (traceId) => {
    const { members, entries } = get();
    return entries
      .filter((e) => e.traceId === traceId && e.status === "active")
      .map((e) => lookupMember(members, e.userId))
      .filter((m): m is TeamMember => m !== undefined);
  },

  getMembersOnSpan: (spanId) => {
    const { members, entries } = get();
    return entries
      .filter((e) => e.spanId === spanId && e.status === "active")
      .map((e) => lookupMember(members, e.userId))
      .filter((m): m is TeamMember => m !== undefined);
  },
}));
