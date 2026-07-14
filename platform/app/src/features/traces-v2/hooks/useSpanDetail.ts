import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

export function useSpanDetail() {
  const { isReady, queryArgs } = useTraceQueryArgs();
  const spanId = useDrawerStore((s) => s.selectedSpanId);

  return api.tracesV2.spanDetail.useQuery(
    { ...queryArgs, spanId: spanId ?? "" },
    {
      enabled: isReady && !!spanId,
      staleTime: 300_000,
    },
  );
}
