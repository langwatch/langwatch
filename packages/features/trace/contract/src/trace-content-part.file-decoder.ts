import type { BinaryPart } from "./trace-content-part.types";

export function parseBase64DataUri(
  uri: string,
): { mimeType: string; base64: string } | null {
  if (!uri.startsWith("data:")) return null;
  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) return null;
  const header = uri.slice(5, commaIdx);
  if (!header.endsWith(";base64")) return null;
  const semiIdx = header.indexOf(";");
  const mimeType = header.slice(0, semiIdx).toLowerCase();
  if (!mimeType) return null;
  return { mimeType, base64: uri.slice(commaIdx + 1) };
}

export function openAiFilePayloadToBinaryPart(
  file: Record<string, unknown>,
): BinaryPart | null {
  const fileData = typeof file.file_data === "string" ? file.file_data : undefined;
  if (!fileData) return null;
  const filename = typeof file.filename === "string" ? file.filename : undefined;

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

export function mediaTypeToAudioFormat(mediaType: string): string | undefined {
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
