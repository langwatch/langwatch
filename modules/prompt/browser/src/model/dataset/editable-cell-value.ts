import type { DatasetColumnType } from "@langwatch/dataset-contract";

export const JSON_LIKE_TYPES: DatasetColumnType[] = [
  "json",
  "list",
  "chat_messages",
  "spans",
  "rag_contexts",
  "annotations",
  "evaluations",
];

type ValidCellValue = { valid: true; normalized: string };
type InvalidCellValue = { valid: false };

export type CellValueValidation = ValidCellValue | InvalidCellValue;

function validateBoolean(value: string): CellValueValidation {
  const trimmed = value.trim().toLowerCase();

  if (trimmed === "" || trimmed === "true" || trimmed === "1") {
    return {
      valid: true,
      normalized: trimmed === "" ? "" : "true",
    };
  }

  if (trimmed === "false" || trimmed === "0") {
    return { valid: true, normalized: "false" };
  }

  return { valid: false };
}

function validateNumber(value: string): CellValueValidation {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { valid: true, normalized: "" };
  }

  const hasDecimalComma = trimmed.includes(",") && !trimmed.includes(".");
  const normalized = hasDecimalComma ? trimmed.replace(",", ".") : trimmed;
  const numberPattern = /^-?\d+(\.\d+)?$/;

  if (!numberPattern.test(normalized)) {
    return { valid: false };
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return { valid: false };
  }

  return { valid: true, normalized: String(parsed) };
}

export function validateCellValue(
  dataType: DatasetColumnType | undefined,
  value: string,
): CellValueValidation {
  if (dataType === "boolean") {
    return validateBoolean(value);
  }

  if (dataType === "number") {
    return validateNumber(value);
  }

  return { valid: true, normalized: value };
}

export function formatJsonCellValue(value: string): {
  formatted: string;
  isJson: boolean;
} {
  const trimmed = value.trim();
  const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");

  if (!looksLikeJson) {
    return { formatted: value, isJson: false };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
  } catch {
    return { formatted: value, isJson: false };
  }
}

export function truncateCellValue(
  value: string,
  maxLength: number,
): { text: string; truncated: boolean } {
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }

  return { text: `${value.slice(0, maxLength)}…`, truncated: true };
}
