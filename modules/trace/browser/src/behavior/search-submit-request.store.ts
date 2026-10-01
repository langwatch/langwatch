import { create } from "zustand";

/** A text another part of the page asked the search bar to submit. */
export interface SearchSubmitRequest {
  text: string;
  /** Makes two identical requests two distinct values. */
  nonce: number;
}

interface SearchSubmitRequestState {
  request: SearchSubmitRequest | null;
  requestSubmit: (request: Omit<SearchSubmitRequest, "nonce">) => void;
  clear: () => void;
}

/**
 * A request to submit a text through the search bar, as if it had been typed
 * and entered: the bar owns routing and the cost rule, so a button elsewhere
 * hands its text over rather than starting anything itself.
 */
export const useSearchSubmitRequestStore = create<SearchSubmitRequestState>((set, get) => ({
  request: null,
  requestSubmit: (request) =>
    set({ request: { ...request, nonce: (get().request?.nonce ?? 0) + 1 } }),
  clear: () => set({ request: null }),
}));
