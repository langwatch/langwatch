/**
 * Compatibility layer: next/navigation → the family's route port.
 *
 * `platform/app`'s shim mapped these onto react-router, which a feature-web
 * package may not import. Every one of them is a reading of the address, and
 * the address is exactly what `WorkflowHostPort.route()` hands over.
 */
import { useRouter } from "../../studio-host/next-router";
import { useWorkflowHost } from "../../model/workflow-host";

export { useRouter } from "../../studio-host/next-router";

export function usePathname(): string {
  return useRouter().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { query } = useWorkflowHost().route();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== void 0) params.set(key, value);
  }
  return params;
}

export function useParams<
  T extends Record<string, string | string[]> = Record<string, string>,
>(): T {
  return useWorkflowHost().route().params as unknown as T;
}

export function redirect(url: string): never {
  window.location.href = url;
  throw new Error(`Redirecting to ${url}`);
}

export function notFound(): never {
  throw new Response("Not Found", { status: 404 });
}
