export const CopyLine = ({ text }) => {
  return (
    <div
      className="lw-copy-prompt"
      data-track="docs_copy_line"
      data-track-text={text}
      data-copy={text}
    >
      <span style={{ fontSize: "14px" }}>"{text}"</span>
      <span className="lw-copy-line-icon" style={{ color: "#9ca3af", display: "flex", padding: "4px" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      </span>
      <span className="lw-copy-line-check" style={{ color: "#059669", display: "none", padding: "4px" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      </span>
    </div>
  );
};
