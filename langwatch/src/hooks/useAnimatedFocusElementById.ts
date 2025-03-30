import { useCallback } from "react";

export const useAnimatedFocusElementById = () => {
  return useCallback((id: string) => {
    const element = document.getElementById(id);
    console.log("element", element);
    if (element) {
      element.focus();
      element.setAttribute("data-focus", "true");
      element.setAttribute("data-focus-visible", "true");
      element.setAttribute("data-focus-visible-animated", "true");
    }
    const handleBlur = () => {
      element?.removeAttribute("data-focus");
      element?.removeAttribute("data-focus-visible");
      element?.removeAttribute("data-focus-visible-animated");
    };
    element?.addEventListener("blur", handleBlur, { once: true });
    element?.addEventListener("click", handleBlur, { once: true });
    element?.addEventListener("keydown", handleBlur, { once: true });
    element?.addEventListener("touchstart", handleBlur, { once: true });
  }, []);
};
