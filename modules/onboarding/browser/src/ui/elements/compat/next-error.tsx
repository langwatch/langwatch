import { TYPE_SCALE_PX } from "@langwatch/design-system/typography";

/**
 * Replacement for next/error — simple error page component.
 */
export default function ErrorPage({ statusCode, title }: { statusCode?: number; title?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        {statusCode && (
          <h1
            style={{
              fontSize: TYPE_SCALE_PX.pageTitle,
              fontWeight: 700,
              margin: "0 0 0.5rem",
            }}
          >
            {statusCode}
          </h1>
        )}
        <p style={{ fontSize: TYPE_SCALE_PX.body, color: "var(--chakra-colors-fg-muted)" }}>
          {title ?? "An error occurred"}
        </p>
      </div>
    </div>
  );
}
