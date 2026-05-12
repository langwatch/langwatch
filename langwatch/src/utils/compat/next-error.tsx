/**
 * Replacement for next/error — simple error page component.
 */
export default function ErrorPage({
  statusCode,
  title,
}: {
  statusCode?: number;
  title?: string;
}) {
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
              fontSize: "2rem",
              fontWeight: 700,
              margin: "0 0 0.5rem",
            }}
          >
            {statusCode}
          </h1>
        )}
        <p style={{ fontSize: "1rem", color: "#666" }}>
          {title ?? "An error occurred"}
        </p>
      </div>
    </div>
  );
}
