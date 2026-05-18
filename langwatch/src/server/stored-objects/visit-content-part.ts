/**
 * visitContentPart — shared decoder for the message content-part union.
 *
 * Both the server-side content extractor and the client-side message renderer
 * need to case-split on the same shape. Without a shared decoder each new
 * part type requires shotgun surgery across both files.
 *
 * The walker speaks langwatch's tracer `chatRichContentSchema` plus the
 * AG-UI `image`/`audio`/`video`/`document` source-shape (for forward-compat
 * with the AG-UI rollout). Every production message variant — `text`,
 * `image_url`, `binary`, `tool_call`, `tool_result`, bare image — has a
 * visitor branch.
 */

// ---------------------------------------------------------------------------
// Visitor interface
// ---------------------------------------------------------------------------

/** Source shape for image/audio/video/document parts. */
export type ContentSource =
  | { type: "url"; value: string; mimeType?: string }
  | { type: "data"; value: string; mimeType: string };

/** Binary part — exactly the ag-ui BinaryInputContent shape. */
export interface BinaryPart {
  type: "binary";
  mimeType: string;
  data?: string;
  url?: string;
  id?: string;
  filename?: string;
}

/**
 * Synchronous visitor over the production message content-part union.
 *
 * - `text` — {type:"text", text:"..."} or bare string
 * - `media` — image/audio/video/document with a typed source (AG-UI shape)
 * - `binary` — {type:"binary", mimeType, data?, url?, id?}
 * - `imageUrl` — OpenAI {type:"image_url", image_url:{url:"..."}}.
 *   This is the production shape for image content (data: URI or
 *   already-externalized URL). Not legacy — actively in use.
 * - `bareImage` — {image:"..."} shape (rare; some fixtures)
 * - `toolCall` — tool_use / tool_call shapes
 * - `toolResult` — tool_result shape
 * - `unknown` — anything unrecognised (optional, defaults to no-op)
 */
export type ContentPartVisitor<R> = {
  text(text: string): R;
  media(part: {
    type: "image" | "audio" | "video" | "document";
    source: ContentSource;
  }): R;
  binary(part: BinaryPart): R;
  toolCall(part: { name: string; arguments: unknown }): R;
  toolResult(part: { result: unknown }): R;
  imageUrl?(url: string): R;
  bareImage?(src: string): R;
  // OpenAI Realtime API audio: {type:"input_audio", input_audio:{data, format?}}
  inputAudio?(part: {
    data?: string;
    url?: string;
    format?: string;
    mimeType?: string;
  }): R;
  unknown?(value: unknown): R;
};

/**
 * Async-capable visitor over the production message content-part union.
 *
 * Each handler may return `R` or `Promise<R>`. Use with `visitContentPartAsync`
 * when the visitor needs to perform I/O (e.g. uploading bytes to object storage).
 */
export type AsyncContentPartVisitor<R> = {
  text(text: string): R | Promise<R>;
  media(part: {
    type: "image" | "audio" | "video" | "document";
    source: ContentSource;
  }): R | Promise<R>;
  binary(part: BinaryPart): R | Promise<R>;
  toolCall(part: { name: string; arguments: unknown }): R | Promise<R>;
  toolResult(part: { result: unknown }): R | Promise<R>;
  imageUrl?(url: string): R | Promise<R>;
  bareImage?(src: string): R | Promise<R>;
  inputAudio?(part: {
    data?: string;
    url?: string;
    format?: string;
    mimeType?: string;
  }): R | Promise<R>;
  unknown?(value: unknown): R | Promise<R>;
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatches a single raw content-part (from an AG-UI content array) to the
 * matching visitor branch. Returns the visitor's return value, or `undefined`
 * when the part is unrecognised and no `unknown` handler is provided.
 *
 * The function is intentionally loose on the input type (`unknown`) so that
 * the server can pass Zod-inferred values and the client can pass unvalidated
 * wire data — both work because we check shape at runtime.
 */
export function visitContentPart<R>(
  part: unknown,
  visitor: ContentPartVisitor<R>,
): R | undefined {
  // Bare string
  if (typeof part === "string") {
    return visitor.text(part);
  }

  if (typeof part !== "object" || part === null) {
    return visitor.unknown?.(part);
  }

  const o = part as Record<string, unknown>;

  // text parts: {type:"text", text/content:"..."} or {text:"..."} (no type)
  if (o["type"] === "text" || (!o["type"] && o["text"])) {
    const text = (o["text"] ?? o["content"] ?? "") as string;
    return visitor.text(text);
  }

  // media parts: image / audio / video / document with a source object
  if (
    (o["type"] === "image" ||
      o["type"] === "audio" ||
      o["type"] === "video" ||
      o["type"] === "document") &&
    o["source"]
  ) {
    return visitor.media({
      type: o["type"] as "image" | "audio" | "video" | "document",
      source: o["source"] as ContentSource,
    });
  }

  // OpenAI Realtime API audio: {type:"input_audio", input_audio:{data, format?}}
  // After server-side extraction the part has {url, mimeType} instead of
  // {data} — both shapes flow through this branch so the renderer can play
  // either an inline base64 turn (pre-extraction) or an externalized
  // /api/files/<id> reference.
  if (
    o["type"] === "input_audio" &&
    typeof o["input_audio"] === "object" &&
    o["input_audio"] !== null
  ) {
    const ia = o["input_audio"] as Record<string, unknown>;
    const data = typeof ia["data"] === "string" ? ia["data"] : undefined;
    const url = typeof ia["url"] === "string" ? ia["url"] : undefined;
    if (data || url) {
      return visitor.inputAudio
        ? visitor.inputAudio({
            data,
            url,
            format: typeof ia["format"] === "string" ? ia["format"] : undefined,
            mimeType:
              typeof ia["mimeType"] === "string" ? ia["mimeType"] : undefined,
          })
        : visitor.unknown?.(part);
    }
  }

  // binary parts
  if (o["type"] === "binary" && o["mimeType"]) {
    return visitor.binary({
      type: "binary",
      mimeType: o["mimeType"] as string,
      data: o["data"] as string | undefined,
      url: o["url"] as string | undefined,
      id: o["id"] as string | undefined,
      filename: o["filename"] as string | undefined,
    });
  }

  // tool_use / tool_call
  if (o["type"] === "tool_use" || o["type"] === "tool_call") {
    return visitor.toolCall({
      name: (o["name"] ?? o["toolName"] ?? "tool") as string,
      arguments: o["arguments"] ?? o["input"] ?? o["args"],
    });
  }

  // tool_result
  if (o["type"] === "tool_result") {
    return visitor.toolResult({ result: o["content"] ?? o["result"] });
  }

  // OpenAI-shaped image: {type:"image_url", image_url:{url:"..."}}
  // (production shape; data: URI extraction handled by visitor)
  if (
    o["type"] === "image_url" &&
    typeof o["image_url"] === "object" &&
    o["image_url"] !== null &&
    (o["image_url"] as Record<string, unknown>)["url"]
  ) {
    const url = (o["image_url"] as Record<string, unknown>)["url"] as string;
    return visitor.imageUrl
      ? visitor.imageUrl(url)
      : visitor.unknown?.(part);
  }

  // Bare {image:"..."} shape (rare; some fixtures)
  if (o["image"]) {
    const src = o["image"] as string;
    return visitor.bareImage
      ? visitor.bareImage(src)
      : visitor.unknown?.(part);
  }

  return visitor.unknown?.(part);
}

// ---------------------------------------------------------------------------
// Async dispatcher
// ---------------------------------------------------------------------------

/**
 * Async variant of `visitContentPart`. Dispatches a single raw content-part to
 * the matching handler on an `AsyncContentPartVisitor<R>`, awaiting the result.
 *
 * Use this on the server side where handlers perform I/O (e.g. writing bytes to
 * object storage). For purely synchronous visitors, prefer `visitContentPart`.
 */
export async function visitContentPartAsync<R>(
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): Promise<R | undefined> {
  // Bare string
  if (typeof part === "string") {
    return visitor.text(part);
  }

  if (typeof part !== "object" || part === null) {
    return visitor.unknown?.(part);
  }

  const o = part as Record<string, unknown>;

  // text parts: {type:"text", text/content:"..."} or {text:"..."} (no type)
  if (o["type"] === "text" || (!o["type"] && o["text"])) {
    const text = (o["text"] ?? o["content"] ?? "") as string;
    return visitor.text(text);
  }

  // media parts: image / audio / video / document with a source object
  if (
    (o["type"] === "image" ||
      o["type"] === "audio" ||
      o["type"] === "video" ||
      o["type"] === "document") &&
    o["source"]
  ) {
    return visitor.media({
      type: o["type"] as "image" | "audio" | "video" | "document",
      source: o["source"] as ContentSource,
    });
  }

  // OpenAI Realtime API audio: {type:"input_audio", input_audio:{data, format?}}
  // After server-side extraction the part has {url, mimeType} instead of
  // {data} — both shapes flow through this branch so the renderer can play
  // either an inline base64 turn (pre-extraction) or an externalized
  // /api/files/<id> reference.
  if (
    o["type"] === "input_audio" &&
    typeof o["input_audio"] === "object" &&
    o["input_audio"] !== null
  ) {
    const ia = o["input_audio"] as Record<string, unknown>;
    const data = typeof ia["data"] === "string" ? ia["data"] : undefined;
    const url = typeof ia["url"] === "string" ? ia["url"] : undefined;
    if (data || url) {
      return visitor.inputAudio
        ? visitor.inputAudio({
            data,
            url,
            format: typeof ia["format"] === "string" ? ia["format"] : undefined,
            mimeType:
              typeof ia["mimeType"] === "string" ? ia["mimeType"] : undefined,
          })
        : visitor.unknown?.(part);
    }
  }

  // binary parts
  if (o["type"] === "binary" && o["mimeType"]) {
    return visitor.binary({
      type: "binary",
      mimeType: o["mimeType"] as string,
      data: o["data"] as string | undefined,
      url: o["url"] as string | undefined,
      id: o["id"] as string | undefined,
      filename: o["filename"] as string | undefined,
    });
  }

  // tool_use / tool_call
  if (o["type"] === "tool_use" || o["type"] === "tool_call") {
    return visitor.toolCall({
      name: (o["name"] ?? o["toolName"] ?? "tool") as string,
      arguments: o["arguments"] ?? o["input"] ?? o["args"],
    });
  }

  // tool_result
  if (o["type"] === "tool_result") {
    return visitor.toolResult({ result: o["content"] ?? o["result"] });
  }

  // OpenAI-shaped image: {type:"image_url", image_url:{url:"..."}}
  // (production shape; data: URI extraction handled by visitor)
  if (
    o["type"] === "image_url" &&
    typeof o["image_url"] === "object" &&
    o["image_url"] !== null &&
    (o["image_url"] as Record<string, unknown>)["url"]
  ) {
    const url = (o["image_url"] as Record<string, unknown>)["url"] as string;
    return visitor.imageUrl
      ? visitor.imageUrl(url)
      : visitor.unknown?.(part);
  }

  // Bare {image:"..."} shape (rare; some fixtures)
  if (o["image"]) {
    const src = o["image"] as string;
    return visitor.bareImage
      ? visitor.bareImage(src)
      : visitor.unknown?.(part);
  }

  return visitor.unknown?.(part);
}
