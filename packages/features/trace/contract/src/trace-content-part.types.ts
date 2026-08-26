export type ContentSource =
  | { type: "url"; value: string; mimeType?: string }
  | { type: "data"; value: string; mimeType?: string };

export interface BinaryPart {
  type: "binary";
  mimeType: string;
  data?: string;
  url?: string;
  id?: string;
  filename?: string;
}

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
  inputAudio?(part: {
    data?: string;
    url?: string;
    format?: string;
    mimeType?: string;
  }): R;
  unknown?(value: unknown): R;
};

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
