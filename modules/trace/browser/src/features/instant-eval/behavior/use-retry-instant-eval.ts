/**
 * Retry for a chip whose run failed: the failed run is forgotten, so the
 * query goes back through the search bar and starts the same eval as Enter.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { useExplorerStore } from "../../../behavior/explorer.store.ts";
import { useSearchSubmitRequestStore } from "../../explorer/behavior/search-submit-request.store.ts";

export function useRetryInstantEval(): (chipKey: string) => void {
  const requestSubmit = useSearchSubmitRequestStore((s) => s.requestSubmit);
  return (chipKey) => {
    const { evalRuns, setEvalRuns, queryText } = useExplorerStore.getState();
    const { [chipKey]: _failed, ...rest } = evalRuns;
    setEvalRuns(rest);
    requestSubmit({ text: queryText });
  };
}
