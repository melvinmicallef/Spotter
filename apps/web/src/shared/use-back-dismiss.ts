import { useEffect, useRef } from 'react';

import { appNavigation } from './app-navigation.js';

/** Give a modal one Back step without changing its screen's route. */
export function useBackDismiss(onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => appNavigation().openOverlay(() => close.current()), []);
}
