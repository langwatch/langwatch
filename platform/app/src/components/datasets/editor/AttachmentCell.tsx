/**
 * The cell body of an `image` or a `file` column in the dataset grid.
 *
 * Both surfaces that render the grid use it: the dataset editor and the
 * evaluations workbench. The cell value stays a plain string, so a user can
 * still double click the cell and type an address or a data URL; the controls
 * here only save the round trip of finding a file, hosting it somewhere and
 * pasting a link.
 *
 * Four states:
 *   - empty: an Upload button and a link that opens the text editor;
 *   - uploading: a spinner and the name of the file;
 *   - filled image: the picture, with Replace and Clear on hover;
 *   - filled file: a chip that opens the file, with the same two actions.
 *
 * A value that is neither an address nor a reference renders as text, which is
 * what every other column type does with it.
 *
 * @see specs/datasets/dataset-attachment-cells.feature
 */
import {
  Box,
  Button,
  HStack,
  IconButton,
  Spinner,
  Text,
} from "@chakra-ui/react";
import { ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";

import { ExternalImage, getImageUrl } from "~/components/ExternalImage";
import { resolveErrorCopy } from "~/features/errors";
import {
  attachmentDisplayName,
  isDatasetAttachmentRef,
} from "~/shared/datasets/attachment-ref";

import { useAttachmentUpload } from "./useAttachmentUpload";

/** The column types this cell renders. */
export type AttachmentColumnType = "image" | "file";

/** What a filled cell shows: the picture itself, or a chip for the file. */
type FilledAttachment =
  | { kind: "image"; src: string }
  | { kind: "file"; href: string };

type AttachmentCellProps = {
  value: string;
  columnType: AttachmentColumnType;
  /** The dataset that owns an uploaded file. */
  datasetId: string;
  /** Text to render for a value that is neither an address nor a reference. */
  fallbackText: string;
  fallbackTruncated: boolean;
  /** Writes the cell value. */
  onChange: (value: string) => void;
  /** Opens the text editor, the same one a double click opens. */
  onOpenEditor: () => void;
};

export function AttachmentCell({
  value,
  columnType,
  datasetId,
  fallbackText,
  fallbackTruncated,
  onChange,
  onOpenEditor,
}: AttachmentCellProps) {
  const {
    inputRef,
    uploadingName,
    uploadError,
    pickFile,
    handleFileChosen,
    clear,
  } = useAttachmentUpload({ datasetId, onChange });

  return (
    <Box
      data-testid={`attachment-cell-${columnType}`}
      css={{
        "&:hover [data-attachment-actions], &:focus-within [data-attachment-actions]":
          { opacity: 1 },
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
          <AttachmentChip
            href={filled.href}
            name={attachmentDisplayName(value)}
          />
        )}
        <FilledActions
          columnType={columnType}
          onReplace={onUpload}
          onClear={onClear}
        />
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
        {columnType === "image" ? (
          <ImageIcon size={12} />
        ) : (
          <Paperclip size={12} />
        )}
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
      <IconButton
        aria-label={`Replace ${noun}`}
        size="2xs"
        variant="ghost"
        onClick={onReplace}
      >
        <Upload size={12} />
      </IconButton>
      <IconButton
        aria-label={`Clear ${noun}`}
        size="2xs"
        variant="ghost"
        onClick={onClear}
      >
        <Trash2 size={12} />
      </IconButton>
    </HStack>
  );
}

/**
 * The chip a filled file cell shows. Opens the file in a new tab.
 *
 * A browser refuses a top-level navigation to a `data:` URL, so a cell that
 * holds one opens a blob of the same bytes instead. Everything else is a plain
 * link, which keeps the middle click and the context menu a link has.
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
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="attachment-chip"
      >
        {body}
      </a>
    </Box>
  );
}

/**
 * Opens the bytes of a `data:` cell value in a new tab.
 *
 * The bytes are handed to the browser as a blob of the same media type. The
 * media type was already narrowed by `attachmentHref`, so nothing the browser
 * runs is opened this way. The address is released once the tab has it, so a
 * cell the person clicks many times holds no memory.
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
  const copy = resolveErrorCopy({ error, fallbackTitle: "Upload failed" });

  return (
    <Box
      data-testid="attachment-upload-error"
      color="red.fg"
      fontSize="11px"
      marginTop={1}
    >
      <Text lineClamp={2}>{copy.title}</Text>
      {copy.description && <Text lineClamp={2}>{copy.description}</Text>}
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
    const src =
      getImageUrl(value) ?? (isDatasetAttachmentRef(value) ? value.trim() : "");
    return src ? { kind: "image", src } : null;
  }

  const href = attachmentHref(value);
  return href ? { kind: "file", href } : null;
}

/** The media types a `data:` cell value is allowed to open as a link. */
const OPENABLE_DATA_URL_RE =
  /^data:(?:image\/|audio\/|video\/|application\/pdf\b)/i;

/**
 * Where the chip points. A LangWatch reference and an address on another site
 * open as they are. A data URL opens only for a media type the browser shows
 * as a document, because opening one of another type navigates the person to
 * content of our own origin that the read route never served. Anything else
 * has no file behind it, so the chip is drawn as plain text.
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
