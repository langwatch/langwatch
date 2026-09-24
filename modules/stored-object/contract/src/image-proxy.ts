import { z } from "zod";

/** `GET /api/image-proxy?url=` - an absent `url` is main's 400, not a validation refusal. */
export const imageProxyQuerySchema = z.object({ url: z.string().optional() });

export type ImageProxyRequest = z.infer<typeof imageProxyQuerySchema>;

/** An upstream refusal keeps its own status; one outside this list answers 502. */
export const IMAGE_PROXY_UPSTREAM_STATUSES = [
  400, 401, 403, 404, 405, 406, 408, 409, 410, 413, 414, 415, 416, 418, 422, 429, 451, 500, 501,
  502, 503, 504,
] as const;

export type ImageProxyStatus = 200 | (typeof IMAGE_PROXY_UPSTREAM_STATUSES)[number];

/** What the proxy answers: the picture, or main's flat `{ error }` body at main's status. */
export type ImageProxyAnswer = Readonly<{
  status: ImageProxyStatus;
  mediaType: string;
  body: AsyncIterable<Uint8Array>;
  headers: Readonly<Record<string, string>>;
}>;
