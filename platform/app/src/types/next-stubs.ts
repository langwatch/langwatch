/**
 * Type stubs replacing Next.js types.
 * These allow us to remove the `next` package from dependencies.
 *
 * Only the fields actually used by our server code are typed here.
 */
import type { IncomingMessage, ServerResponse } from "http";

/** Stub for next.NextApiRequest — Node IncomingMessage + helpers */
export interface NextApiRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>;
  body?: any;
  cookies: Record<string, string>;
  env: Record<string, string | undefined>;
}

/** Stub for next.NextApiResponse — Node ServerResponse + helpers */
export interface NextApiResponse<T = any> extends ServerResponse {
  status(code: number): NextApiResponse<T>;
  json(body: T): void;
  send(body: any): void;
  redirect(url: string): void;
  redirect(status: number, url: string): void;
  setHeader(name: string, value: string | string[]): this;
}

/** Stub for next/server.NextRequest — extends web Request */
export type NextRequest = Request;

/** Stub for next.GetServerSidePropsContext */
export interface GetServerSidePropsContext {
  req: IncomingMessage & { cookies: Record<string, string> };
  res: ServerResponse;
  params?: Record<string, string | string[]>;
  query: Record<string, string | string[] | undefined>;
  resolvedUrl: string;
}

/** Stub for next.GetServerSidePropsResult */
export type GetServerSidePropsResult<P> =
  | { props: P }
  | { redirect: { destination: string; permanent: boolean } }
  | { notFound: true };
