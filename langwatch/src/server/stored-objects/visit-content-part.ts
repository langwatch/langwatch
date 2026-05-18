/**
 * visitContentPart — shared decoder for the AG-UI content-part union.
 *
 * Both the server-side content extractor and the client-side message renderer
 * need to case-split on the same shape. Without a shared decoder each new
 * AG-UI part type requires shotgun surgery across both files.
 *
 * The server visitor only handles `media` and `binary` (Zod-validated input).
 * The client visitor also handles legacy `image_url`, bare `image`, and
 * `tool_call`/`tool_result` shapes that the server's Zod gate already rejects.
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
 * Visitor over the AG-UI content-part union.
 *
 * - `text` — {type:"text", text:"..."} or bare string
 * - `media` — image/audio/video/document with a typed source
 * - `binary` — binary part
 * - `toolCall` — tool_use / tool_call shapes
 * - `toolResult` — tool_result shape
 * - `legacyImageUrl` — OpenAI {type:"image_url", image_url:{url:"..."}}
 * - `legacyImage` — bare {image:"..."} shape
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
  legacyImageUrl?(url: string): R;
  legacyImage?(src: string): R;
  unknown?(value: unknown): R;
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

  // legacy: OpenAI image_url shape {type:"image_url", image_url:{url:"..."}}
  if (
    o["type"] === "image_url" &&
    typeof o["image_url"] === "object" &&
    o["image_url"] !== null &&
    (o["image_url"] as Record<string, unknown>)["url"]
  ) {
    const url = (o["image_url"] as Record<string, unknown>)["url"] as string;
    return visitor.legacyImageUrl
      ? visitor.legacyImageUrl(url)
      : visitor.unknown?.(part);
  }

  // legacy: bare image {image:"..."}
  if (o["image"]) {
    const src = o["image"] as string;
    return visitor.legacyImage
      ? visitor.legacyImage(src)
      : visitor.unknown?.(part);
  }

  return visitor.unknown?.(part);
}
