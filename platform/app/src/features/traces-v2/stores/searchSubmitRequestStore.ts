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
 * A request to submit a text through the search bar, as if the user had typed
 * it and pressed Enter. The bar owns routing (filter, phrase, Instant Eval or
 * Langy) and the cost rule behind a run, so a button elsewhere on the page
 * hands its text over here instead of starting anything on its own.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("An empty table under an
 * unjudged chip says these results are not judged").
 */
export const useSearchSubmitRequestStore = create<SearchSubmitRequestState>(
  (set, get) => ({
    request: null,
    requestSubmit: (request) =>
      set({ request: { ...request, nonce: (get().request?.nonce ?? 0) + 1 } }),
    clear: () => set({ request: null }),
  }),
);
