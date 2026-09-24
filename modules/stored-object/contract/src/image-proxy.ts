import { z } from "zod";

/** `GET /api/image-proxy?url=` - an absent `url` is main's 400, not a validation refusal. */
export const imageProxyQuerySchema = z.object({ url: z.string().optional() });

export type ImageProxyRequest = z.infer<typeof imageProxyQuerySchema>;
