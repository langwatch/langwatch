/**
 * Conversations this tab has archived. The list is a projection that can still carry a row for
 * a moment after the archive is accepted; hiding it here keeps a refetch from bringing it back.
 */
import { create } from "zustand";

interface LangyDeletedConversationsState {
  ids: ReadonlySet<string>;
  hide: (id: string) => void;
}

export const useLangyDeletedConversationsStore = create<LangyDeletedConversationsState>()(
  (set) => ({
    ids: new Set<string>(),
    hide: (id) => set((s) => ({ ids: new Set(s.ids).add(id) })),
  }),
);
