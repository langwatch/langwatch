/** What an outside address answered when asked for a picture. */
export type ExternalImageResponse = Readonly<{
  ok: boolean;
  status: number;
  statusText: string;
  contentType: string | null;
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
}>;

/** Pictures at addresses this deployment does not own, fetched behind the egress fence. */
export interface ExternalImageChannel {
  fetch(url: string): Promise<ExternalImageResponse>;
}
