/**
 * An attachment travels as one data URL string, so a mustache body, a parameter
 * and a component input all take it; an agent reading a conversation gets it
 * back as a content part. @see specs/experiments-v3/attachment-inputs.feature
 */

/** Bytes with the type and the name they are sent under. */
export type AttachmentBytes = {
  mediaType: string;
  bytes: Buffer;
  name?: string;
};

/** A data URL read back into its parts. */
export type ParsedAttachmentDataUrl = {
  mediaType: string;
  base64: string;
  name?: string;
};

/** What an attachment looks like inside a message the agent reads. */
export type AttachmentContentPart =
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

/** What a file part is called when the data URL carries no name. */
const UNNAMED_ATTACHMENT = "attachment";

/**
 * The data URL an attachment travels as. An image carries no `;name=`: every
 * image reader matches a bare `data:image/...;base64,`. Everything else carries
 * one, which is what puts a file name on the attachment the model reads.
 */
export const attachmentDataUrl = ({ mediaType, bytes, name }: AttachmentBytes): string => {
  const base64 = bytes.toString("base64");
  if (isImageType(mediaType) || !name) {
    return `data:${mediaType};base64,${base64}`;
  }
  return `data:${mediaType};name=${encodeURIComponent(name)};base64,${base64}`;
};

/** Whether the media type names an image. */
export const isImageType = (mediaType: string): boolean =>
  mediaType.toLowerCase().startsWith("image/");

/**
 * A base64 data URL read back into its parts, or nothing. Only the base64 form:
 * the run writes no other, and a text data URL carries no attachment.
 */
export const parseAttachmentDataUrl = (value: string): ParsedAttachmentDataUrl | null => {
  if (!value.startsWith("data:")) return null;
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return null;

  const header = value.slice("data:".length, commaIndex);
  if (!header.endsWith(";base64")) return null;

  const [mediaType, ...parameters] = header.slice(0, -";base64".length).split(";");
  if (!mediaType) return null;

  const nameParameter = parameters.find((parameter) => parameter.startsWith("name="));
  const name = nameParameter ? decodeName(nameParameter.slice("name=".length)) : undefined;

  return {
    mediaType: mediaType.toLowerCase(),
    base64: value.slice(commaIndex + 1),
    ...(name ? { name } : {}),
  };
};

/**
 * The attachment as a content part: images and named audio formats get media
 * parts, everything else a named file part. Not a base64 data URL: nothing.
 */
export const toAttachmentContentPart = (value: string): AttachmentContentPart | null => {
  const parsed = parseAttachmentDataUrl(value);
  if (!parsed) return null;

  if (isImageType(parsed.mediaType)) {
    return { type: "image_url", image_url: { url: value } };
  }

  const audio = pickAudioFormat(parsed.mediaType);
  if (audio) {
    return {
      type: "input_audio",
      input_audio: { data: parsed.base64, format: audio },
    };
  }

  return {
    type: "file",
    file: {
      filename: parsed.name ?? UNNAMED_ATTACHMENT,
      file_data: value,
    },
  };
};

/**
 * The format a model reads an audio clip under, read off the media type and
 * never defaulted: a wrong token makes the provider read Ogg or FLAC as WAV.
 * A type not listed here travels as a file part instead.
 */
const AUDIO_FORMATS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/vnd.wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/x-mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
};

const pickAudioFormat = (mediaType: string): string | undefined =>
  AUDIO_FORMATS[mediaType.toLowerCase()];

/** A name as it was written, with a bad escape left alone. */
const decodeName = (name: string): string => {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};
