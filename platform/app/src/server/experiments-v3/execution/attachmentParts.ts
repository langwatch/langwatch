/**
 * The data URL an attachment travels as, and the content part it becomes.
 *
 * A row sends an attachment as one string, so it fits a mustache body, a
 * parameter value and a component input without any of them learning a new
 * shape. An agent that reads a conversation wants a content part instead, so
 * the same string is read back here and turned into one.
 *
 * Free of any runtime: the resolver, the connected agent turn and their tests
 * all read these rules from one place.
 *
 * @see specs/experiments-v3/attachment-inputs.feature
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
 * The data URL an attachment travels as.
 *
 * An image carries no name parameter: the readers of an image value, in the
 * app and in the engine, match a bare `data:image/...;base64,` and a
 * parameter between the two would fall out of every one of them. Everything
 * else carries `;name=`, which is what puts a file name on the attachment the
 * model reads.
 */
export const attachmentDataUrl = ({
  mediaType,
  bytes,
  name,
}: AttachmentBytes): string => {
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
 * A base64 data URL read back into its parts, or nothing.
 *
 * Only the base64 form: the run writes no other one, and a text data URL
 * carries no attachment worth a content part of its own.
 */
export const parseAttachmentDataUrl = (
  value: string,
): ParsedAttachmentDataUrl | null => {
  if (!value.startsWith("data:")) return null;
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return null;

  const header = value.slice("data:".length, commaIndex);
  if (!header.endsWith(";base64")) return null;

  const [mediaType, ...parameters] = header
    .slice(0, -";base64".length)
    .split(";");
  if (!mediaType) return null;

  const nameParameter = parameters.find((parameter) =>
    parameter.startsWith("name="),
  );
  const name = nameParameter
    ? decodeName(nameParameter.slice("name=".length))
    : undefined;

  return {
    mediaType: mediaType.toLowerCase(),
    base64: value.slice(commaIndex + 1),
    ...(name ? { name } : {}),
  };
};

/**
 * The attachment as a content part of the message the agent reads.
 *
 * An image and an audio clip have their own parts, because a model reads them
 * as media rather than as a document. Everything else is a file part, which
 * carries the name so the model can say which document it answered from.
 * A value that is not a base64 data URL is no attachment and yields nothing.
 */
export const attachmentContentPart = (
  value: string,
): AttachmentContentPart | null => {
  const parsed = parseAttachmentDataUrl(value);
  if (!parsed) return null;

  if (isImageType(parsed.mediaType)) {
    return { type: "image_url", image_url: { url: value } };
  }

  if (parsed.mediaType.startsWith("audio/")) {
    return {
      type: "input_audio",
      input_audio: {
        data: parsed.base64,
        format: audioFormat(parsed.mediaType),
      },
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

/** The format name a model reads an audio clip under. */
const audioFormat = (mediaType: string): string => {
  const subtype = mediaType.slice("audio/".length);
  return subtype.includes("mpeg") || subtype.includes("mp3") ? "mp3" : "wav";
};

/** A name as it was written, with a bad escape left alone. */
const decodeName = (name: string): string => {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};
