import { api } from "~/utils/api";
import {
  asSharedQueryResult,
  useSharedTrace,
} from "../context/SharedTraceContext";
import { useDrawerStore } from "../stores/drawerStore";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

export function useSpanDetail() {
  const shared = useSharedTrace();
  const { isReady, queryArgs } = useTraceQueryArgs();
  const spanId = useDrawerStore((s) => s.selectedSpanId);

  const query = api.tracesV2.spanDetail.useQuery(
    { ...queryArgs, spanId: spanId ?? "" },
    {
      enabled: isReady && !!spanId && !shared,
      staleTime: 300_000,
    },
  );

  if (shared) {
    // The shared payload's spansFull entries are the bulk-mapped details:
    // they carry no per-span events and no llm ancestor-prompt enrichment
    // (both live only on the single-span `tracesV2.spanDetail` read). The
    // trace-level events timeline covers the share page; per-span events in
    // the payload are an ADR-057 follow-up.
    const detail = spanId
      ? shared.spansFull.find((s) => s.spanId === spanId)
      : undefined;
    return asSharedQueryResult(detail) as unknown as typeof query;
  }
  return query;
}
