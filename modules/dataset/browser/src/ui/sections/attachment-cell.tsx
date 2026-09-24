/**
 * The cell body of an `image` or a `file` column: empty, uploading, filled
 * image or filled file. The value stays a plain string a user can still type.
 * @see specs/datasets/dataset-attachment-cells.feature
 */
import { Box, Button, HStack, IconButton, Spinner, Text } from "@chakra-ui/react";
import { describeError } from "@langwatch/browser-host/errors";
import type { DatasetAttachmentSlot } from "@langwatch/dataset-browser-kit";
import { attachmentDisplayName, isDatasetAttachmentRef } from "@langwatch/dataset-contract";
import { ExternalImage, getImageUrl } from "@langwatch/design-system/external-image";
import { ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";

import { useAttachmentUpload } from "../../behavior/use-attachment-upload.ts";

/** The column types this cell renders. */
export type AttachmentColumnType = "image" | "file";

/** What a filled cell shows: the picture itself, or a chip for the file. */
type FilledAttachment = { kind: "image"; src: string } | { kind: "file"; href: string };

export function AttachmentCell({
  value,
  columnType,
  fallbackText,
  fallbackTruncated,
  onChange,
  onOpenEditor,
}: DatasetAttachmentSlot) {
  const { inputRef, uploadingName, uploadError, pickFile, handleFileChosen, clear } =
    useAttachmentUpload({ onChange });

  return (
    <Box
      data-testid={`attachment-cell-${columnType}`}
      css={{
        "&:hover [data-attachment-actions], &:focus-within [data-attachment-actions]": {
          opacity: 1,
        },
      }}
    >
      <input
        ref={inputRef}
        type="file"
        data-testid="attachment-file-input"
        accept={columnType === "image" ? "image/*" : undefined}
        onChange={(event) => {
          void handleFileChosen(event);
        }}
        style={{ display: "none" }}
      />

      <AttachmentBody
        value={value}
        columnType={columnType}
        uploadingName={uploadingName}
        fallbackText={fallbackText}
        fallbackTruncated={fallbackTruncated}
        onUpload={pickFile}
        onClear={clear}
        onOpenEditor={onOpenEditor}
      />

      {uploadError !== null && <UploadError error={uploadError} />}
    </Box>
  );
}

/** The one state the cell is in. */
function AttachmentBody({
  value,
  columnType,
  uploadingName,
  fallbackText,
  fallbackTruncated,
  onUpload,
  onClear,
  onOpenEditor,
}: {
  value: string;
  columnType: AttachmentColumnType;
  uploadingName: string | null;
  fallbackText: string;
  fallbackTruncated: boolean;
  onUpload: () => void;
  onClear: () => void;
  onOpenEditor: () => void;
}) {
  if (uploadingName !== null) {
    return (
      <HStack gap={1} color="fg.muted" fontSize="12px">
        <Spinner size="xs" />
        <Text lineClamp={1}>{uploadingName}</Text>
      </HStack>
    );
  }

  const filled = readFilledValue({ value, columnType });
  if (filled) {
    return (
      <HStack gap={1} align="start">
        {filled.kind === "image" ? (
          <ExternalImage
            src={filled.src}
            minWidth="24px"
            minHeight="24px"
            maxHeight="80px"
            maxWidth="100%"
            expandable
          />
        ) : (
          <AttachmentChip href={filled.href} name={attachmentDisplayName(value)} />
        )}
        <FilledActions columnType={columnType} onReplace={onUpload} onClear={onClear} />
      </HStack>
    );
  }

  if (value) {
    return (
      <>
        {fallbackText}
        {fallbackTruncated && (
          <Box as="span" color="fg.subtle" fontSize="11px" marginLeft={1}>
            (truncated)
          </Box>
        )}
      </>
    );
  }

  return (
    <HStack gap={2} color="fg.muted">
      <Button size="2xs" variant="ghost" onClick={onUpload}>
        {columnType === "image" ? <ImageIcon size={12} /> : <Paperclip size={12} />}
        Upload
      </Button>
      <Button
        size="2xs"
        variant="plain"
        height="auto"
        padding={0}
        color="fg.muted"
        textDecoration="underline"
        onClick={onOpenEditor}
      >
        or enter URL
      </Button>
    </HStack>
  );
}

/**
 * Replace and Clear, on hover and on keyboard focus. Icon only because a cell
 * has no room for two labels beside the file, so both carry a label that a
 * screen reader reads.
 */
function FilledActions({
  columnType,
  onReplace,
  onClear,
}: {
  columnType: AttachmentColumnType;
  onReplace: () => void;
  onClear: () => void;
}) {
  const noun = columnType === "image" ? "image" : "file";

  return (
    <HStack data-attachment-actions gap={0} opacity={0}>
      <IconButton aria-label={`Replace ${noun}`} size="2xs" variant="ghost" onClick={onReplace}>
        <Upload size={12} />
      </IconButton>
      <IconButton aria-label={`Clear ${noun}`} size="2xs" variant="ghost" onClick={onClear}>
        <Trash2 size={12} />
      </IconButton>
    </HStack>
  );
}

/**
 * The chip a filled file cell shows; opens the file in a new tab. A browser
 * refuses to navigate to a `data:` URL, so one opens as a blob of its bytes.
 */
function AttachmentChip({ href, name }: { href: string; name: string }) {
  const body = (
    <Box
      display="inline-flex"
      alignItems="center"
      gap={1}
      maxWidth="100%"
      paddingX={1.5}
      paddingY={0.5}
      borderRadius="sm"
      borderWidth="1px"
      borderColor="border.emphasized"
      bg="bg.subtle"
      fontSize="12px"
      _hover={{ bg: "bg.muted" }}
    >
      <Paperclip size={12} />
      <Text lineClamp={1}>{name}</Text>
    </Box>
  );

  if (href.startsWith("data:")) {
    return (
      <Box asChild>
        <button
          type="button"
          data-testid="attachment-chip"
          onClick={() => {
            openDataUrl({ dataUrl: href, name });
          }}
        >
          {body}
        </button>
      </Box>
    );
  }

  return (
    <Box asChild>
      <a href={href} target="_blank" rel="noopener noreferrer" data-testid="attachment-chip">
        {body}
      </a>
    </Box>
  );
}

/**
 * Opens a `data:` value's bytes in a new tab, as a blob of the media type
 * `attachmentHref` already narrowed; the address is released once opened.
 */
function openDataUrl({ dataUrl, name }: { dataUrl: string; name: string }) {
  const blob = blobFromDataUrl(dataUrl);
  if (!blob) return;

  const objectUrl = URL.createObjectURL(blob);
  const opened = window.open(objectUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    // A blocked pop-up leaves the person with nothing, so the file is saved
    // under its own name instead.
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = name;
    link.click();
  }
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 60_000);
}

/** The bytes of a base64 or percent-encoded `data:` URL, or nothing. */
function blobFromDataUrl(dataUrl: string): Blob | null {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return null;

  const header = dataUrl.slice("data:".length, commaIndex);
  const isBase64 = header.endsWith(";base64");
  const mediaType =
    (isBase64 ? header.slice(0, -";base64".length) : header).split(";")[0] ||
    "application/octet-stream";
  const payload = dataUrl.slice(commaIndex + 1);

  try {
    if (!isBase64) {
      return new Blob([decodeURIComponent(payload)], { type: mediaType });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mediaType });
  } catch {
    return null;
  }
}

/** The words a refused upload shows, under the controls. */
function UploadError({ error }: { error: unknown }) {
  const copy = describeError({ error, fallbackTitle: "Upload failed" });

  return (
    <Box data-testid="attachment-upload-error" color="red.fg" fontSize="11px" marginTop={1}>
      <Text lineClamp={3}>{copy}</Text>
    </Box>
  );
}

/** What the cell shows for a value it can render, or null for anything else. */
function readFilledValue({
  value,
  columnType,
}: {
  value: string;
  columnType: AttachmentColumnType;
}): FilledAttachment | null {
  if (columnType === "image") {
    // `getImageUrl` reads the shapes a user can type: an address, a markdown
    // image, a data URL. An uploaded picture is a LangWatch reference, which
    // is a relative path, so it is read here.
    const src = getImageUrl(value) ?? (isDatasetAttachmentRef(value) ? value.trim() : "");
    return src ? { kind: "image", src } : null;
  }

  const href = attachmentHref(value);
  return href ? { kind: "file", href } : null;
}

/** The media types a `data:` cell value is allowed to open as a link. */
const OPENABLE_DATA_URL_RE = /^data:(?:image\/|audio\/|video\/|application\/pdf\b)/i;

/**
 * Where the chip points: a reference or an address as it is, a data URL only
 * for a media type shown as a document (anything else would be our origin
 * serving content the read route never served), otherwise nothing.
 */
function attachmentHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isDatasetAttachmentRef(trimmed)) return trimmed;
  if (trimmed.startsWith("data:")) {
    return OPENABLE_DATA_URL_RE.test(trimmed) ? trimmed : null;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}
