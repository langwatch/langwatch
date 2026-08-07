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

/** The `input_audio` payload every audio-carrying part shape resolves to. */
interface InputAudioPart {
  data?: string;
  url?: string;
  format?: string;
  mimeType?: string;
}

/** Media part — image/audio/video/document with a typed source (AG-UI shape). */
interface MediaContentPart {
  type: "image" | "audio" | "video" | "document";
  source: ContentSource;
}

/**
 * Visitor over the production message content-part union, parameterised by
 * what a handler returns — `R` for the synchronous visitor, `R | Promise<R>`
 * for the async one. One shape, so both dispatchers share a single walker.
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
type ContentPartVisitorOf<Returned> = {
  text(text: string): Returned;
  media(part: MediaContentPart): Returned;
  binary(part: BinaryPart): Returned;
  toolCall(part: { name: string; arguments: unknown }): Returned;
  toolResult(part: { result: unknown }): Returned;
  imageUrl?(url: string): Returned;
  bareImage?(src: string): Returned;
  // OpenAI Realtime API audio: {type:"input_audio", input_audio:{data, format?}}
  inputAudio?(part: InputAudioPart): Returned;
  unknown?(value: unknown): Returned;
};

/** Synchronous visitor over the production message content-part union. */
export type ContentPartVisitor<R> = ContentPartVisitorOf<R>;

/**
 * Async-capable visitor over the production message content-part union.
 *
 * Each handler may return `R` or `Promise<R>`. Use with `visitContentPartAsync`
 * when the visitor needs to perform I/O (e.g. uploading bytes to object storage).
 */
export type AsyncContentPartVisitor<R> = ContentPartVisitorOf<R | Promise<R>>;

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * The visitor branch a raw part resolves to, carrying that branch's argument.
 * Matching is pure and returns one of these; `applyContentPartDispatch` makes
 * the single visitor call. Splitting the two is what lets the sync and async
 * dispatchers share one walker.
 */
type ContentPartDispatch =
  | { kind: "text"; text: string }
  | { kind: "media"; media: MediaContentPart }
  | { kind: "binary"; binary: BinaryPart }
  | { kind: "inputAudio"; audio: InputAudioPart }
  | { kind: "toolCall"; toolCall: { name: string; arguments: unknown } }
  | { kind: "toolResult"; toolResult: { result: unknown } }
  | { kind: "imageUrl"; url: string }
  | { kind: "bareImage"; src: string }
  | { kind: "unknown" };

// text parts: {type:"text", text/content:"..."} or {text:"..."} (no type)
function matchTextPart(o: Record<string, unknown>): ContentPartDispatch | null {
  if (o.type === "text" || (!o.type && o.text)) {
    return { kind: "text", text: (o.text ?? o.content ?? "") as string };
  }
  return null;
}

// media parts: image / audio / video / document with a source object
function matchMediaPart(
  o: Record<string, unknown>,
): ContentPartDispatch | null {
  if (
    (o.type === "image" ||
      o.type === "audio" ||
      o.type === "video" ||
      o.type === "document") &&
    o.source
  ) {
    return {
      kind: "media",
      media: {
        type: o.type as "image" | "audio" | "video" | "document",
        source: o.source as ContentSource,
      },
    };
  }
  return null;
}

// OpenAI Realtime API audio: {type:"input_audio", input_audio:{data, format?}}
// After server-side extraction the part has {url, mimeType} instead of
// {data} — both shapes flow through this branch so the renderer can play
// either an inline base64 turn (pre-extraction) or an externalized
// /api/files/<id> reference.
function matchInputAudioPart(
  o: Record<string, unknown>,
): ContentPartDispatch | null {
  if (
    o.type !== "input_audio" ||
    typeof o.input_audio !== "object" ||
    o.input_audio === null
  ) {
    return null;
  }
  const ia = o.input_audio as Record<string, unknown>;
  const data = typeof ia.data === "string" ? ia.data : undefined;
  const url = typeof ia.url === "string" ? ia.url : undefined;
  if (!data && !url) return null;
  return {
    kind: "inputAudio",
    audio: {
      data,
      url,
      format: typeof ia.format === "string" ? ia.format : undefined,
      mimeType: typeof ia.mimeType === "string" ? ia.mimeType : undefined,
    },
  };
}

// AI-SDK file part: {type:"file", mediaType:"audio/...", data:"<base64>"}.
// The TypeScript scenario SDK emits this shape from `createAudioMessage`
// (see voice/messages.ts in langwatch/scenario). Newer SDK builds translate
// audio file parts to `input_audio` before sending, but older SDKs and
// first-party non-scenario callers may still ship the raw `file` shape;
// routing it here means the extractor externalises the bytes to stored-
// objects the same way it already does for `input_audio`, instead of
// dropping into the no-op `unknown` branch and letting full base64
// payloads land in ClickHouse Messages.Content. Audio mediaTypes go to
// `inputAudio` (preserves a playable shape downstream); other file payloads
// go to `binary` (generic externalisation by mimeType).
function matchAiSdkFilePart(
  o: Record<string, unknown>,
): ContentPartDispatch | null {
  if (o.type !== "file" || typeof o.mediaType !== "string") return null;
  // MIME types are case-insensitive per RFC 2045 §5.1, so an `Audio/WAV`
  // file part routes the same as `audio/wav`. The dispatched part carries
  // the lowercased type — the readback allowlist and storage Content-Type
  // both expect the canonical form.
  const mimeType = o.mediaType.toLowerCase();
  const data = typeof o.data === "string" ? o.data : undefined;
  const url = typeof o.url === "string" ? o.url : undefined;
  if (!data && !url) return null;
  if (mimeType.startsWith("audio/")) {
    return {
      kind: "inputAudio",
      audio: { data, url, format: mediaTypeToAudioFormat(mimeType), mimeType },
    };
  }
  return {
    kind: "binary",
    binary: {
      type: "binary",
      mimeType,
      data,
      url,
      id: typeof o.id === "string" ? o.id : undefined,
      filename: typeof o.filename === "string" ? o.filename : undefined,
    },
  };
}

// OpenAI ChatCompletion file part: {type:"file", file:{filename?, file_data?, file_id?}}.
// The scenario multimodal-files docs instruct exactly this shape for
// document attachments in simulated user messages. Bytes dispatch to
// `binary` (or `inputAudio` for audio mime types, keeping a playable shape
// downstream) so the extractor externalises them; a `file_id`-only part
// references a provider-hosted file with no bytes, so it falls through to
// `unknown` and passes along unchanged.
function matchOpenAiFilePart(
  o: Record<string, unknown>,
): ContentPartDispatch | null {
  if (o.type !== "file" || typeof o.file !== "object" || o.file === null) {
    return null;
  }
  const binPart = openAiFilePayloadToBinaryPart(
    o.file as Record<string, unknown>,
  );
  if (binPart?.mimeType.startsWith("audio/")) {
    return {
      kind: "inputAudio",
      audio: {
        data: binPart.data,
        format: mediaTypeToAudioFormat(binPart.mimeType),
        mimeType: binPart.mimeType,
      },
    };
  }
  if (binPart) {
    return { kind: "binary", binary: binPart };
  }
  return { kind: "unknown" };
}

// binary parts
function matchBinaryPart(
  o: Record<string, unknown>,
): ContentPartDispatch | null {
  if (o.type !== "binary" || !o.mimeType) return null;
  return {
    kind: "binary",
    binary: {
      type: "binary",
      mimeType: o.mimeType as string,
      data: o.data as string | undefined,
      url: o.url as string | undefined,
      id: o.id as string | undefined,
      filename: o.filename as string | undefined,
    },
  };
}

// tool_use / tool_call, then tool_result
function matchToolPart(o: Record<string, unknown>): ContentPartDispatch | null {
  if (o.type === "tool_use" || o.type === "tool_call") {
    return {
      kind: "toolCall",
      toolCall: {
        name: (o.name ?? o.toolName ?? "tool") as string,
        arguments: o.arguments ?? o.input ?? o.args,
      },
    };
  }
  if (o.type === "tool_result") {
    return {
      kind: "toolResult",
      toolResult: { result: o.content ?? o.result },
    };
  }
  return null;
}

// OpenAI-shaped image: {type:"image_url", image_url:{url:"..."}} or the
// shorthand string form {type:"image_url", image_url:"..."}.
// (production shapes; data: URI extraction handled by visitor)
function matchImagePart(
  o: Record<string, unknown>,
): ContentPartDispatch | null {
  const url = imageUrlFromPart(o);
  if (url !== null) {
    return { kind: "imageUrl", url };
  }
  // Bare {image:"..."} shape (rare; some fixtures). The value must be a
  // string — the generic value walker dispatches arbitrary objects here, and
  // a non-string `image` property (e.g. {image: {width}}) is not a part.
  if (typeof o.image === "string" && o.image) {
    return { kind: "bareImage", src: o.image };
  }
  return null;
}

/**
 * Resolves a raw content-part to its visitor branch. The probes are chained in
 * wire-shape priority order — the first that recognises the part wins, and a
 * part no probe claims is `unknown`.
 */
function matchContentPart(part: unknown): ContentPartDispatch {
  // Bare string
  if (typeof part === "string") {
    return { kind: "text", text: part };
  }

  if (typeof part !== "object" || part === null) {
    return { kind: "unknown" };
  }

  const o = part as Record<string, unknown>;

  return (
    matchTextPart(o) ??
    matchMediaPart(o) ??
    matchInputAudioPart(o) ??
    matchAiSdkFilePart(o) ??
    matchOpenAiFilePart(o) ??
    matchBinaryPart(o) ??
    matchToolPart(o) ??
    matchImagePart(o) ?? { kind: "unknown" }
  );
}

/**
 * Calls the one visitor handler the matched branch names. Branches whose
 * handler is optional fall back to `unknown`, which is itself optional — an
 * absent handler is a no-op returning `undefined`.
 */
function applyContentPartDispatch<Returned>({
  dispatch,
  part,
  visitor,
}: {
  dispatch: ContentPartDispatch;
  part: unknown;
  visitor: ContentPartVisitorOf<Returned>;
}): Returned | undefined {
  switch (dispatch.kind) {
    case "text":
      return visitor.text(dispatch.text);
    case "media":
      return visitor.media(dispatch.media);
    case "binary":
      return visitor.binary(dispatch.binary);
    case "inputAudio":
      return visitor.inputAudio
        ? visitor.inputAudio(dispatch.audio)
        : visitor.unknown?.(part);
    case "toolCall":
      return visitor.toolCall(dispatch.toolCall);
    case "toolResult":
      return visitor.toolResult(dispatch.toolResult);
    case "imageUrl":
      return visitor.imageUrl
        ? visitor.imageUrl(dispatch.url)
        : visitor.unknown?.(part);
    case "bareImage":
      return visitor.bareImage
        ? visitor.bareImage(dispatch.src)
        : visitor.unknown?.(part);
    case "unknown":
      return visitor.unknown?.(part);
  }
}

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
  return applyContentPartDispatch({
    dispatch: matchContentPart(part),
    part,
    visitor,
  });
}

/**
 * The `image_url` carrier in both wire forms: the OpenAI object form
 * ({type:"image_url", image_url:{url:"..."}}) and the shorthand string form
 * ({type:"image_url", image_url:"..."}) some SDKs emit. Returns the url, or
 * null when the part is not an image_url carrier.
 */
function imageUrlFromPart(o: Record<string, unknown>): string | null {
  if (o.type !== "image_url") return null;
  const carrier = o.image_url;
  if (typeof carrier === "string" && carrier) return carrier;
  if (
    typeof carrier === "object" &&
    carrier !== null &&
    typeof (carrier as Record<string, unknown>).url === "string"
  ) {
    return (carrier as Record<string, unknown>).url as string;
  }
  return null;
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
  return applyContentPartDispatch<R | Promise<R>>({
    dispatch: matchContentPart(part),
    part,
    visitor,
  });
}

/**
 * Parse a `data:` URI into its mime type + base64 payload. Returns null when
 * the input isn't a `data:<mime>[;param=value...];base64,<...>` shape;
 * non-base64 data URIs (`data:<mime>,<urlencoded>`) are out of scope —
 * extraction is for binary payloads only, not for short URL-encoded text.
 *
 * Spec: RFC 2397, only the `base64` form. The mime type is the substring
 * BEFORE the first `;`, so parameterized URIs
 * (`data:application/pdf;name=doc.pdf;base64,...`) resolve to the bare type —
 * never a parameter-laden string that would fail the readback allowlist or
 * leak into storage Content-Type headers. Lowercased per RFC 2045 §5.1.
 *
 * Single source of truth for both the visitor's file dispatch and the
 * content-extractor's image/bareImage handlers — one parser, one behaviour.
 */
export function parseBase64DataUri(
  uri: string,
): { mimeType: string; base64: string } | null {
  if (!uri.startsWith("data:")) return null;
  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) return null;
  const header = uri.slice(5, commaIdx); // strip "data:"
  if (!header.endsWith(";base64")) return null;
  const semiIdx = header.indexOf(";");
  const mimeType = header.slice(0, semiIdx).toLowerCase();
  if (!mimeType) return null;
  return { mimeType, base64: uri.slice(commaIdx + 1) };
}

/**
 * Decode an OpenAI ChatCompletion `file` payload ({file_data, filename,
 * file_id}) into a binary part the visitor can dispatch. `file_data` accepts
 * both a base64 data: URI (the shape the scenario multimodal-files docs
 * instruct) and raw base64 (the OpenAI API wire format), resolving the mime
 * type from the data URI header or the filename extension. Returns null when
 * the payload carries no bytes (e.g. provider-hosted `file_id` references)
 * or the data URI is malformed, so the caller can fall through to `unknown`
 * and pass the part along unchanged.
 */
function openAiFilePayloadToBinaryPart(
  file: Record<string, unknown>,
): BinaryPart | null {
  const fileData =
    typeof file.file_data === "string" ? file.file_data : undefined;
  if (!fileData) return null;
  const filename =
    typeof file.filename === "string" ? file.filename : undefined;

  if (fileData.startsWith("data:")) {
    const parsed = parseBase64DataUri(fileData);
    if (!parsed) return null;
    return {
      type: "binary",
      mimeType: parsed.mimeType,
      data: parsed.base64,
      filename,
    };
  }

  return {
    type: "binary",
    mimeType: mimeTypeFromFilename(filename),
    data: fileData,
    filename,
  };
}

/**
 * Mime type for a raw-base64 OpenAI `file_data` payload, inferred from the
 * filename extension. Audio extensions must resolve to `audio/*` so the part
 * routes through the `input_audio` externalization path and stays playable;
 * image extensions keep the /api/files readback faithful. Everything else
 * downgrades to a generic download.
 */
function mimeTypeFromFilename(filename: string | undefined): string {
  const ext = filename?.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "md":
      return "text/markdown";
    case "wav":
      return "audio/wav";
    case "mp3":
      return "audio/mpeg";
    case "flac":
      return "audio/flac";
    case "ogg":
      return "audio/ogg";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

/**
 * Best-effort `format` hint for the OpenAI Realtime `input_audio` shape based
 * on an AI-SDK `mediaType` ("audio/wav", "audio/mpeg", etc.). Returns
 * `undefined` for non-canonical types (e.g. "audio/pcm16") — the mimeType is
 * still preserved on the dispatched part for downstream handling.
 */
function mediaTypeToAudioFormat(mediaType: string): string | undefined {
  // Case-insensitive (RFC 2045 §5.1). Callers in this file already lowercase
  // before passing in, but normalise here too so any future caller is safe.
  switch (mediaType.toLowerCase()) {
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mpeg":
      return "mp3";
    case "audio/flac":
      return "flac";
    case "audio/ogg":
      return "ogg";
    case "audio/webm":
      return "webm";
    default:
      return undefined;
  }
}
