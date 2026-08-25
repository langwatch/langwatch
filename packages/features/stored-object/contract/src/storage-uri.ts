export type StoredObjectStorageDestination =
  | { kind: "s3"; bucket: string }
  | { kind: "file"; root: string }
  | { kind: "azure"; accountName: string; container: string };

export const STORED_OBJECT_STORAGE_SCHEMES = ["s3", "file", "azure-blob"] as const;
export type StoredObjectStorageScheme = (typeof STORED_OBJECT_STORAGE_SCHEMES)[number];

export function mintStoredObjectUri({
  destination,
  objectPath,
}: {
  destination: StoredObjectStorageDestination;
  objectPath: string;
}): string {
  switch (destination.kind) {
    case "s3":
      return `s3://${destination.bucket}/${objectPath}`;
    case "file": {
      const root = destination.root.startsWith("/")
        ? destination.root
        : `/${destination.root}`;
      return `file://${root}/${objectPath}`;
    }
    case "azure":
      return `azure-blob://${destination.accountName}/${destination.container}/${objectPath}`;
  }
}

export function mintS3StoredObjectUri(input: {
  bucket: string;
  projectId: string;
  sha256: string;
}): string {
  return mintStoredObjectUri({
    destination: { kind: "s3", bucket: input.bucket },
    objectPath: `${input.projectId}/${input.sha256}`,
  });
}

export function mintFileStoredObjectUri(input: {
  root: string;
  projectId: string;
  sha256: string;
}): string {
  return mintStoredObjectUri({
    destination: { kind: "file", root: input.root },
    objectPath: `${input.projectId}/${input.sha256}`,
  });
}

export function mintAzureBlobStoredObjectUri(input: {
  accountName: string;
  container: string;
  projectId: string;
  sha256: string;
}): string {
  return mintStoredObjectUri({
    destination: {
      kind: "azure",
      accountName: input.accountName,
      container: input.container,
    },
    objectPath: `${input.projectId}/${input.sha256}`,
  });
}

export function getStoredObjectStorageScheme(uri: string): StoredObjectStorageScheme {
  const colonIndex = uri.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Unrecognised URI scheme in "${uri}": no colon found`);
  }
  const scheme = uri.slice(0, colonIndex);
  switch (scheme) {
    case "s3":
    case "file":
    case "azure-blob":
      return scheme;
    default:
      throw new Error(
        `Unrecognised URI scheme "${scheme}" in "${uri}". Supported: ${STORED_OBJECT_STORAGE_SCHEMES.join(", ")}`,
      );
  }
}

export function redactStoredObjectStorageUri(uri: string): string {
  try {
    const separator = uri.indexOf("://");
    if (separator === -1) {
      return uri;
    }

    const scheme = uri.slice(0, separator);
    const rest = uri.slice(separator + 3);

    switch (scheme.toLowerCase()) {
      case "s3":
      case "gs": {
        const slash = rest.indexOf("/");
        return slash === -1 ? `${scheme}://***` : `${scheme}://***${rest.slice(slash)}`;
      }
      case "azure-blob": {
        const segments = rest.split("/");
        const safe = segments.slice(2).join("/");

        return `${scheme}://***/***${safe ? `/${safe}` : ""}`;
      }
      case "file": {
        const slash = rest.indexOf("/", 1);
        if (slash === -1) {
          return `${scheme}:///***`;
        }

        const tail = rest.slice(slash);
        const lastTwoSlashes = tail.lastIndexOf("/", tail.lastIndexOf("/") - 1);

        return `${scheme}://***${lastTwoSlashes === -1 ? "" : tail.slice(lastTwoSlashes)}`;
      }
      default:
        return uri;
    }
  } catch {
    return "<unredactable-uri>";
  }
}

const STORAGE_URI_IN_TEXT = /\b(?:s3|azure-blob|gs|file):\/\/[^\s'"]+/gi;
const AUTHORIZATION_MATERIAL_IN_TEXT =
  /\b(Bearer|SharedKey|SharedKeyLite)\s+[A-Za-z0-9\-._~+/=:]{20,}/gi;
const CREDENTIAL_FIELD_IN_TEXT =
  /\b(access_token|id_token|refresh_token|client_assertion|assertion|client_secret)\b("?)(\s*[=:]\s*)("?)[A-Za-z0-9\-._~+/=]{20,}("?)/gi;
const XML_ASSERTION_IN_TEXT =
  /<(AuthenticationErrorDetail|assertion|client_assertion)\b[^>]*>[\s\S]*?<\/\1>/gi;

export function redactStoredObjectStorageUrisInText(text: string): string {
  return text.replace(STORAGE_URI_IN_TEXT, (uri) => redactStoredObjectStorageUri(uri));
}

export function redactStoredObjectAuthorizationMaterial(text: string): string {
  return text
    .replace(AUTHORIZATION_MATERIAL_IN_TEXT, (_match, scheme: string) => `${scheme} ***`)
    .replace(CREDENTIAL_FIELD_IN_TEXT, (_match, ...captures: string[]) => {
      const [field, keyQuote, separator, openQuote, closeQuote] = captures;
      return `${field}${keyQuote}${separator}${openQuote}***${closeQuote}`;
    })
    .replace(XML_ASSERTION_IN_TEXT, (_match, tag: string) => `<${tag}>***</${tag}>`);
}

export function redactStoredObjectStorageErrorText(text: string): string {
  return redactStoredObjectAuthorizationMaterial(
    redactStoredObjectStorageUrisInText(text),
  );
}
