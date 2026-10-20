import { useGatewayHost } from "../model/gateway-host.ts";

/**
 * Closes a URL-routed gateway drawer: the caller's own close when one was handed in, otherwise
 * every `drawer.*` key leaves the address and the rest of the query stays.
 */
export function useCloseGatewayDrawer(onClose: (() => void) | undefined): () => void {
  const host = useGatewayHost();
  if (onClose) return onClose;
  return () => {
    const next: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(host.route().query)) {
      next[key] = key.startsWith("drawer.") ? void 0 : value;
    }
    host.setQuery(next);
  };
}
