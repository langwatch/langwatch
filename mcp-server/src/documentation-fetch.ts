export type DocumentationKind = "langwatch" | "scenario";

const TRUSTED_DOCUMENTATION_ORIGIN = "https://langwatch.ai";
const MAX_DOCUMENTATION_BYTES = 2 * 1024 * 1024;
const DOCUMENTATION_CONTENT_TYPES = new Set(["text/markdown", "text/plain"]);

const DOCUMENTATION_CONFIG: Record<DocumentationKind, { defaultPath: string; namespace: string }> = {
  langwatch: {
    defaultPath: "/docs/llms.txt",
    namespace: "/docs",
  },
  scenario: {
    defaultPath: "/scenario/llms.txt",
    namespace: "/scenario",
  },
};

function documentationUrlError(namespace: string): Error {
  return new Error(
    `Only a trusted LangWatch documentation URL under ${TRUSTED_DOCUMENTATION_ORIGIN}${namespace}/ may be fetched`
  );
}

export function resolveDocumentationUrl(kind: DocumentationKind, input?: string): URL {
  const { defaultPath, namespace } = DOCUMENTATION_CONFIG[kind];
  const value = input?.trim();
  let url: URL;

  try {
    if (!value) {
      url = new URL(defaultPath, TRUSTED_DOCUMENTATION_ORIGIN);
    } else if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith("//")) {
      url = new URL(value, TRUSTED_DOCUMENTATION_ORIGIN);
    } else {
      const relativePath = value.replace(/^\/+/, "");
      const namespacePath = namespace.slice(1);
      const path =
        relativePath === namespacePath || relativePath.startsWith(`${namespacePath}/`)
          ? `/${relativePath}`
          : `${namespace}/${relativePath}`;
      url = new URL(path, TRUSTED_DOCUMENTATION_ORIGIN);
    }
  } catch {
    throw documentationUrlError(namespace);
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "langwatch.ai" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith(`${namespace}/`)
  ) {
    throw documentationUrlError(namespace);
  }

  const lowerPath = url.pathname.toLowerCase();
  if (!lowerPath.endsWith(".md") && !lowerPath.endsWith(".txt")) {
    url.pathname += ".md";
  }

  return url;
}

export async function fetchDocumentation(
  kind: DocumentationKind,
  input?: string,
  fetchImplementation: typeof fetch = fetch
): Promise<string> {
  const url = resolveDocumentationUrl(kind, input);
  const response = await fetchImplementation(url, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`Documentation request failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (!DOCUMENTATION_CONTENT_TYPES.has(contentType)) {
    throw new Error("Documentation response has an unexpected content type");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DOCUMENTATION_BYTES) {
    throw new Error("Documentation response is too large");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_DOCUMENTATION_BYTES) {
      await reader.cancel();
      throw new Error("Documentation response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
}
