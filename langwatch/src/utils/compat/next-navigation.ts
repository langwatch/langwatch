/**
 * Compatibility layer: next/navigation → react-router
 *
 * Provides useRouter, usePathname, useSearchParams, useParams, redirect, notFound
 * that map to React Router equivalents.
 */
import {
  useLocation,
  useNavigate,
  useParams as useRRParams,
  useSearchParams as useRRSearchParams,
} from "react-router";

export { useRouter } from "./next-router";

export function usePathname(): string {
  const location = useLocation();
  return location.pathname;
}

export function useSearchParams(): URLSearchParams {
  const [searchParams] = useRRSearchParams();
  return searchParams;
}

export function useParams<
  T extends Record<string, string | string[]> = Record<string, string>
>(): T {
  return useRRParams() as unknown as T;
}

export function redirect(url: string): never {
  window.location.href = url;
  throw new Error(`Redirecting to ${url}`);
}

export function notFound(): never {
  throw new Response("Not Found", { status: 404 });
}
