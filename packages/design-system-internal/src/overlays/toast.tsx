import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { IconButton } from "../controls/icon-button.tsx";
import { IconClose } from "../icons.tsx";

export type ToastTone = "info" | "ok" | "warning" | "error";

export type ToastProps = {
  title: string;
  description?: string;
  tone?: ToastTone;
  onDismiss?: () => void;
};

export const Toast = ({ title, description, tone = "info", onDismiss }: ToastProps) => (
  <div className="ds-toast" data-tone={tone} role={tone === "error" ? "alert" : "status"}>
    <span className="ds-toast-mark" aria-hidden="true" />
    <div className="ds-toast-content">
      <span className="ds-toast-title">{title}</span>
      {description !== undefined && <span className="ds-toast-description">{description}</span>}
    </div>
    {onDismiss && <IconButton label="Dismiss" icon={<IconClose />} size="sm" onClick={onDismiss} />}
  </div>
);

export type ToastInput = Omit<ToastProps, "onDismiss"> & {
  /** How long it stays; 5 s by default, `0` to stay until dismissed. */
  durationMs?: number;
};

export type Toaster = {
  show: (toast: ToastInput) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<Toaster | undefined>(undefined);

type ShownToast = ToastInput & { id: number };

const DEFAULT_TOAST_MS = 5000;

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ShownToast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...toast, id }]);
      const duration = toast.durationMs ?? DEFAULT_TOAST_MS;
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );
  const toaster = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={toaster}>
      {children}
      <div className="ds-toaster" aria-label="Notifications">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            title={toast.title}
            description={toast.description}
            tone={toast.tone}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

/** The toaster of the nearest `ToastProvider`; throws outside one. */
export const useToast = (): Toaster => {
  const toaster = useContext(ToastContext);
  if (!toaster) throw new Error("useToast needs a ToastProvider above it.");
  return toaster;
};
