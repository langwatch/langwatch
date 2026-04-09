const { useState } = React;

const trackEvent = (name, props) => {
  try { window.posthog?.capture(name, props); } catch {}
};

export const SkillInstall = ({ title, skill, slashCommand, highlighted }) => {
  const [installCopied, setInstallCopied] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);

  const installCmd = `npx skills add ${skill}`;

  const handleCopyInstall = () => {
    navigator.clipboard.writeText(installCmd);
    setInstallCopied(true);
    trackEvent("docs_copy_skill_install", { title, skill });
    setTimeout(() => setInstallCopied(false), 2000);
  };

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(slashCommand);
    setCmdCopied(true);
    trackEvent("docs_copy_slash_command", { title, slashCommand });
    setTimeout(() => setCmdCopied(false), 2000);
  };

  const CopyIcon = ({ size }) => (
    <svg width={size || 14} height={size || 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
  );

  const CheckIcon = ({ size }) => (
    <svg width={size || 14} height={size || 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
  );

  return (
    <div className={highlighted ? "lw-skill-install lw-skill-highlighted" : "lw-skill-install"}>
      <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>
        {title}
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px",
      }}>
        <span style={{ fontSize: "13px", color: "#6b7280", fontFamily: "var(--font-mono, monospace)" }}>&gt;_</span>
        <code style={{ fontSize: "13px", fontFamily: "var(--font-mono, monospace)" }}>{installCmd}</code>
        <button
          onClick={handleCopyInstall}
          className="lw-inline-copy-btn"
          data-track="docs_copy_skill_install"
          data-track-title={title}
          data-track-skill={skill}
          title="Copy install command"
        >
          {installCopied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>

      <div style={{ fontSize: "13px" }}>
        Then use{" "}
        <span style={{ color: "#fe9a00", fontWeight: 600 }}>{slashCommand}</span>
        {" "}
        <button
          onClick={handleCopyCmd}
          className="lw-inline-copy-btn"
          data-track="docs_copy_slash_command"
          data-track-title={title}
          data-track-command={slashCommand}
          title={`Copy ${slashCommand}`}
        >
          {cmdCopied ? <CheckIcon /> : <CopyIcon />}
        </button>
        {" "}in your coding agent
      </div>
    </div>
  );
};
