import { useCallback } from "react";
import { useDrawer } from "./useDrawer";

export function useDrawerCloseCallback(onClose?: () => void) {
  const { closeDrawer } = useDrawer();
  return useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      closeDrawer();
    }
  }, [onClose, closeDrawer]);
}
