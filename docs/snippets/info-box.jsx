export const InfoBox = ({ children }) => {
  return (
    <div className="lw-info-box">
      <div className="lw-info-box-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
      </div>
      <div className="lw-info-box-content">{children}</div>
    </div>
  );
};
