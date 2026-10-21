import { useEffect, useRef } from "react";
import { statuses } from "../../shared/contracts";
export const time = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>{statuses[status] ?? status}</span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Alert({ children }: { children: React.ReactNode }) {
  return children ? (
    <div className="alert" role="alert">
      {children}
    </div>
  ) : null;
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCallback.current();
      if (e.key === "Tab") {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
        );
        if (!focusable?.length) return;
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="overlay" onClick={onClose}>
      <section
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button ref={close} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {children}
    </div>
  );
}
