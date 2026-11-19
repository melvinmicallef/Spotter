import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { Exercise } from '@spotter/shared';

export function ExercisePreview({
  name,
  media,
  className = '',
  children,
}: {
  name: string;
  media: Exercise['media'] | undefined;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pointerId = useRef<number | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  function close() {
    pointerId.current = null;
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    function closeWhenHidden() {
      if (document.hidden) close();
    }

    window.addEventListener('blur', close);
    window.addEventListener('keydown', closeOnEscape);
    document.addEventListener('visibilitychange', closeWhenHidden);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('visibilitychange', closeWhenHidden);
    };
  }, [open]);

  return (
    <>
      <button
        className={`exercise-preview-title ${className}`.trim()}
        type="button"
        aria-label={`Hold to preview ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerId.current = event.pointerId;
          setOpen(true);
        }}
        onPointerUp={(event) => {
          if (event.pointerId === pointerId.current) close();
        }}
        onPointerCancel={close}
        onLostPointerCapture={close}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            if (!event.repeat) setOpen(true);
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            close();
          }
        }}
        onBlur={close}
      >
        {children ?? name}
      </button>
      {open &&
        createPortal(
          <div className="modal-backdrop exercise-preview-backdrop">
            <section
              className="exercise-preview-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
            >
              <h2 id={titleId}>{name}</h2>
              {media ? (
                <img
                  src={media.url}
                  alt={`${name} demonstration`}
                  draggable={false}
                />
              ) : (
                <p>No demonstration available.</p>
              )}
              <small id={descriptionId}>Release to close</small>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
