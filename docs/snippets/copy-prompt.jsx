export const CopyPrompt = ({ title, prompt, boldPrefix, skill }) => {
  if (!prompt) {
    return <div style={{ padding: "12px", color: "red" }}>Error: prompt data not loaded</div>;
  }

  return (
    <div
      className="lw-copy-prompt"
      data-track="docs_copy_prompt"
      data-track-skill={skill}
      data-track-title={boldPrefix ? `${boldPrefix} ${title}` : title}
      data-copy={prompt}
    >
      <span style={{ fontSize: "14px" }}>
        {boldPrefix ? <><strong>{boldPrefix}</strong> {title}</> : title}
      </span>
      <button className="lw-copy-btn">
        <span className="lw-copy-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>Copy Full Prompt</span>
        <span className="lw-check-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>Copied!</span>
      </button>
    </div>
  );
};
