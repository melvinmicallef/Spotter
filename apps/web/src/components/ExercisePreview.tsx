import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { Exercise } from '@spotter/shared';

import { ExerciseDetailsModal } from '../features/catalogue/CatalogueView.js';

export function ExercisePreview({
  name,
  exercise,
  className = '',
  children,
}: {
  name: string;
  exercise: Exercise | undefined;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className={`exercise-preview-title ${className}`.trim()}
        type="button"
        aria-label={`Preview ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!exercise}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onClick={() => setOpen(true)}
      >
        {children ?? name}
      </button>
      {open &&
        exercise &&
        createPortal(
          <ExerciseDetailsModal
            exercise={exercise}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
