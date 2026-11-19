import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open || !dialog.current) return;
    const modal = dialog.current;
    modal.showModal();
    const button = trigger.current;
    function closeOutside(event: MouseEvent) {
      if (event.detail === 0) return;
      const bounds = modal.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        setOpen(false);
    }
    // Backdrop clicks can target the document rather than the native dialog.
    document.addEventListener('click', closeOutside, true);
    return () => {
      document.removeEventListener('click', closeOutside, true);
      button?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        className={`exercise-preview-title ${className}`.trim()}
        type="button"
        aria-label={`Preview ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onClick={() => setOpen(true)}
      >
        {children ?? name}
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="exercise-preview-modal"
            aria-label={name}
            onCancel={(event) => {
              event.preventDefault();
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          >
            <button
              className="exercise-details-modal-close exercise-preview-close"
              type="button"
              aria-label="Close preview"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
            {media ? (
              <img
                src={media.url}
                alt={`${name} demonstration`}
                draggable={false}
              />
            ) : (
              <p>No demonstration available.</p>
            )}
          </dialog>,
          document.body,
        )}
    </>
  );
}
