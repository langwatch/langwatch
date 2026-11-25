const UNITS = ["B", "KB", "MB", "GB"];

export const formatSize = ({ bytes }: { bytes: number }) => {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
};

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript))|\+(json|xml)$/u;

export type Preview = "text" | "image" | "none";

export const previewKind = ({ contentType }: { contentType: string }): Preview => {
  if (contentType.startsWith("image/")) return "image";
  return TEXT_TYPES.test(contentType) ? "text" : "none";
};

/** `storage.<slug>.langwatch.localhost` names its stack; any other host has none. */
export const stackFromHost = ({ hostname }: { hostname: string }) =>
  /^storage\.(.+)\.langwatch\.localhost$/u.exec(hostname)?.[1] ?? "";

/** 2xx reads ok, 4xx a refusal worth a look, 5xx an error; redirects stay neutral. */
export const statusTone = ({ status }: { status: number }) => {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return status >= 200 && status < 300 ? "ok" : "neutral";
};
