import { simFetch } from "@langwatch/sim-console";
import { z } from "zod";

z.config({ jitless: true });

export const bucketSchema = z.object({ name: z.string(), objects: z.number(), size: z.number() });
export type Bucket = z.infer<typeof bucketSchema>;

export const objectSchema = z.object({
  bucket: z.string(),
  key: z.string(),
  size: z.number(),
  contentType: z.string(),
  etag: z.string(),
  lastModified: z.coerce.date(),
});
export type StoredObject = z.infer<typeof objectSchema>;

const detailSchema = z.object({
  ...objectSchema.shape,
  headers: z.record(z.string(), z.string()),
});
export type ObjectDetail = z.infer<typeof detailSchema>;

const requestSchema = z.object({
  method: z.string(),
  bucket: z.string(),
  key: z.string(),
  status: z.number(),
  at: z.coerce.date(),
});
export type RequestEntry = z.infer<typeof requestSchema>;

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const storageApi = {
  buckets: async () =>
    (
      await simFetch({
        path: "/_sim/api/buckets",
        schema: z.object({ buckets: z.array(bucketSchema) }),
      })
    ).buckets,
  objects: async ({ bucket }: { bucket: string }) =>
    (
      await simFetch({
        path: `/_sim/api/objects?${query(bucket === "" ? {} : { bucket })}`,
        schema: z.object({ objects: z.array(objectSchema) }),
      })
    ).objects,
  detail: ({ bucket, key }: { bucket: string; key: string }) =>
    simFetch({ path: `/_sim/api/object?${query({ bucket, key })}`, schema: detailSchema }),
  requests: async () =>
    (
      await simFetch({
        path: "/_sim/api/requests",
        schema: z.object({ requests: z.array(requestSchema) }),
      })
    ).requests,
  rawPath: ({
    bucket,
    key,
    download = false,
  }: {
    bucket: string;
    key: string;
    download?: boolean;
  }) =>
    `/_sim/api/object/raw?${query(download ? { bucket, key, download: "1" } : { bucket, key })}`,
};
