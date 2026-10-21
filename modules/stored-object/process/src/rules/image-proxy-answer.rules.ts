/**
 * What the proxy answers, as data: the picture's bytes and its own headers, or a refusal with
 * the status and error main answered. The transport door writes either as the HTTP response.
 */
export type ImageProxyAnswer =
  | Readonly<{
      kind: "image";
      status: 200;
      body: Uint8Array<ArrayBuffer>;
      headers: Readonly<Record<string, string>>;
    }>
  | Readonly<{ kind: "refused"; status: number; error: string }>;
