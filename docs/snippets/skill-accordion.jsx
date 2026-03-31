export const SkillAccordion = ({ title, boldPrefix, skill, slashCommand, prompt, highlighted }) => {
  const installCmd = skill ? `npx skills add ${skill}` : null;
  const skillPath = skill ? skill.replace("langwatch/skills/", "") : null;
  const skillMdUrl = skillPath
    ? `https://github.com/langwatch/langwatch/blob/main/skills/${skillPath}/SKILL.md`
    : null;
  const runCmd = skill ? `npx skills run ${skill}` : null;

  const CopyIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
  );

  const CheckIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
  );

  return (
    <details className={`lw-accordion${highlighted ? " lw-accordion-highlighted" : ""}`}>
      <summary className="lw-accordion-header">
        <span className="lw-accordion-title">
          {boldPrefix ? <><strong>{boldPrefix}</strong> {title}</> : title}
        </span>
        <svg className="lw-accordion-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </summary>

      <div className="lw-accordion-body">
        {/* Install via CLI + Skill Usage row */}
        {installCmd && (
          <div className="lw-accordion-commands">
            <div className="lw-accordion-cmd-col">
              <div className="lw-accordion-cmd-label">Install via CLI</div>
              <div
                className="lw-accordion-cmd-box"
                data-copy={installCmd}
                data-track="docs_copy_skill_install"
                data-track-title={title}
                data-track-skill={skill}
              >
                <code>{installCmd}</code>
                <span className="lw-inline-copy-btn lw-copy-line-icon"><CopyIcon /></span>
                <span className="lw-inline-copy-btn lw-copy-line-check" style={{ display: "none" }}><CheckIcon /></span>
              </div>
            </div>
            {slashCommand && (
              <div className="lw-accordion-cmd-col">
                <div className="lw-accordion-cmd-label">Skill Usage</div>
                <div
                  className="lw-accordion-cmd-box"
                  data-copy={slashCommand}
                  data-track="docs_copy_slash_command"
                  data-track-title={title}
                  data-track-command={slashCommand}
                >
                  <code><span className="lw-slash-command">{slashCommand}</span></code>
                  <span className="lw-inline-copy-btn lw-copy-line-icon"><CopyIcon /></span>
                  <span className="lw-inline-copy-btn lw-copy-line-check" style={{ display: "none" }}><CheckIcon /></span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action buttons — 2 buttons, each with primary + secondary line */}
        <div className={`lw-accordion-actions${!skill ? " lw-accordion-actions-single" : ""}`}>
          {prompt && (
            <div
              className="lw-accordion-action"
              data-copy={prompt}
              data-track="docs_copy_prompt"
              data-track-title={title}
              data-track-skill={skill || "platform"}
            >
              <span className="lw-accordion-action-icon lw-copy-line-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              </span>
              <span className="lw-accordion-action-icon lw-copy-line-check" style={{ display: "none" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </span>
              <span className="lw-accordion-action-text">
                <span className="lw-accordion-action-title">Copy Full Prompt</span>
                <span className="lw-accordion-action-subtitle">{skill ? "Run skill without installing" : "Paste into any AI assistant"}</span>
              </span>
            </div>
          )}
          {skill && (
            <div
              className="lw-accordion-action"
              data-download-url={`https://raw.githubusercontent.com/langwatch/langwatch/main/skills/${skillPath}/SKILL.md`}
              data-download-name="SKILL.md"
              data-track="docs_download_skill"
              data-track-title={title}
              data-track-skill={skill}
            >
              <span className="lw-accordion-action-icon">
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.25 3.75H2.75C1.64543 3.75 0.75 4.64543 0.75 5.75V12.25C0.75 13.3546 1.64543 14.25 2.75 14.25H15.25C16.3546 14.25 17.25 13.3546 17.25 12.25V5.75C17.25 4.64543 16.3546 3.75 15.25 3.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M8.75 11.25V6.75H8.356L6.25 9.5L4.144 6.75H3.75V11.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M11.5 9.5L13.25 11.25L15 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M13.25 11.25V6.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span className="lw-accordion-action-text">
                <span className="lw-accordion-action-title">Download SKILL.md</span>
                <span className="lw-accordion-action-subtitle">Manual installation</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </details>
  );
};
