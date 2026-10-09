/**
 * The content part an attachment data URL becomes.
 *
 * @see specs/experiments-v3/attachment-inputs.feature
 */
import { describe, expect, it } from "vitest";
import { attachmentContentPart } from "../attachmentParts";

const BYTES = Buffer.from("bytes");
const BASE64 = BYTES.toString("base64");

const dataUrl = ({
  mediaType,
  name,
}: {
  mediaType: string;
  name?: string;
}): string =>
  name
    ? `data:${mediaType};name=${encodeURIComponent(name)};base64,${BASE64}`
    : `data:${mediaType};base64,${BASE64}`;

describe("given a recording in a format a model names", () => {
  describe("when the part is built", () => {
    /** @scenario "A recording in a format a model names travels as an audio part" */
    it.each([
      ["audio/wav", "wav"],
      ["audio/x-wav", "wav"],
      ["audio/mpeg", "mp3"],
      ["audio/mp3", "mp3"],
      ["audio/ogg", "ogg"],
      ["audio/flac", "flac"],
      ["audio/webm", "webm"],
      ["audio/mp4", "m4a"],
      ["audio/aac", "aac"],
    ])("sends %s as an audio part in format %s", (mediaType, format) => {
      expect(attachmentContentPart(dataUrl({ mediaType }))).toEqual({
        type: "input_audio",
        input_audio: { data: BASE64, format },
      });
    });
  });
});

describe("given a recording in a format no model names", () => {
  describe("when the part is built", () => {
    /** @scenario "A recording in a format no model names travels as a file part" */
    it("sends it as a file part rather than calling it WAV", () => {
      const value = dataUrl({ mediaType: "audio/amr", name: "call.amr" });

      expect(attachmentContentPart(value)).toEqual({
        type: "file",
        file: { filename: "call.amr", file_data: value },
      });
    });
  });
});

describe("given a picture", () => {
  describe("when the part is built", () => {
    it("sends it as an image part", () => {
      const value = dataUrl({ mediaType: "image/png" });

      expect(attachmentContentPart(value)).toEqual({
        type: "image_url",
        image_url: { url: value },
      });
    });
  });
});

describe("given a value that is not a base64 data URL", () => {
  describe("when the part is built", () => {
    it("yields nothing, because it carries no attachment", () => {
      expect(attachmentContentPart("https://example.com/shot.png")).toBeNull();
    });
  });
});
