import { LogoMark } from "../../logo-icon.tsx";

/**
 * The LangWatch mark as a model mark, for the models LangWatch serves itself. The 38 by 52 mark
 * sits centred in a square frame, so it fills the icon box as every provider's does.
 */
export function LangWatch() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="-7 0 52 52"
      data-testid="langwatch-mark"
    >
      <LogoMark />
    </svg>
  );
}
