/** System colours only, so the orb follows the reader's scheme without a token of its own. */
export const ORB_STYLES = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  font: 13px/1.4 system-ui, sans-serif; color-scheme: light dark; }
.orb { width: 40px; height: 40px; padding: 6px; border-radius: 50%; cursor: pointer;
  border: 1px solid GrayText; background: Canvas; box-shadow: 0 2px 8px GrayText; }
.orb img { display: block; width: 100%; height: 100%; }
.panel { position: absolute; right: 0; bottom: 52px; width: 320px; max-height: 70vh; overflow: auto;
  display: grid; gap: 10px; padding: 12px; border: 1px solid GrayText; border-radius: 10px;
  background: Canvas; color: CanvasText; }
.panel[hidden], form[hidden] { display: none; }
form { display: grid; gap: 6px; }
.row { display: flex; flex-wrap: wrap; gap: 6px; }
button, a { font: inherit; padding: 3px 8px; border: 1px solid GrayText; border-radius: 6px;
  background: ButtonFace; color: ButtonText; cursor: pointer; text-decoration: none; }
button[aria-pressed="true"] { outline: 2px solid Highlight; }
button:disabled { cursor: wait; opacity: 0.6; }
textarea { font: inherit; width: 100%; box-sizing: border-box; background: Field; color: FieldText; }
.muted { margin: 0; color: GrayText; overflow-wrap: anywhere; }
.layer { position: fixed; inset: 0; pointer-events: none; }
.highlight { position: fixed; outline: 2px solid Highlight; pointer-events: none; }
.sheet { position: fixed; inset: 0; cursor: crosshair; pointer-events: auto; }
`;
