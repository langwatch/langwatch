/**
 * The empty face of a widget that needs a named evaluator or an experiment: a source's
 * own call to action cannot say that, as its data may well be there. Reads the
 * `DASHED`, `CENTRED` and `C` of every widget's frame.
 */
export const SETUP_NOTE = `function SetupNote({ line, children }) {
  return (
    <div style={{ ...DASHED, flex: 1, ...CENTRED, gap: 8, padding: "24px 20px",
      textAlign: "center" }}>
      <div style={{ fontSize: 11.5, color: C.subtle, maxWidth: 340 }}>{line}</div>
      {children}
    </div>
  );
}`;
