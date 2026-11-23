const DEAD_ZONE = .15;

/** One pointer controls a circular stick while other pointers can move the camera. */
export function createMovementJoystick({element, onMove, window: view = globalThis.window}) {
  const thumb = element.querySelector('[data-joystick-thumb]');
  const page = element.ownerDocument;
  let drag = null;

  function paint(x, y) {
    element.style.setProperty('--joystick-x', `${x}px`);
    element.style.setProperty('--joystick-y', `${y}px`);
  }

  function move(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (element.getAttribute('aria-disabled') === 'true') {
      reset();
      return;
    }

    const x = event.clientX - drag.centerX;
    const y = event.clientY - drag.centerY;
    const distance = Math.hypot(x, y);
    if (!Number.isFinite(distance)) return;

    const travel = Math.min(distance, drag.radius);
    const drawScale = distance > 0 ? travel / distance : 0;
    paint(x * drawScale, y * drawScale);

    const level = travel / drag.radius;
    if (level > DEAD_ZONE) {
      const strength = (level - DEAD_ZONE) / (1 - DEAD_ZONE);
      onMove(x / distance * strength, -y / distance * strength);
    } else {
      onMove(0, 0);
    }
    if (event.cancelable) event.preventDefault();
  }

  function end(event) {
    if (drag && event.pointerId === drag.id) reset();
  }

  function reset() {
    if (!drag) return;
    const {id, target} = drag;
    drag = null;
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    try {
      if (element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
    } catch {
      // The pointer may already have ended.
    }
    delete element.dataset.active;
    paint(0, 0);
    onMove(0, 0);
  }

  function begin(event) {
    if (drag || event.button !== 0 || page.hidden || element.getAttribute('aria-disabled') === 'true') return;
    const {left, top, width, height} = element.getBoundingClientRect();
    const thumbSize = Math.max(thumb?.offsetWidth ?? 0, thumb?.offsetHeight ?? 0);
    const radius = (Math.min(width, height) - thumbSize) / 2;
    if (!(radius > 0)) return;

    const id = event.pointerId;
    let target = view ?? element;
    if (element.setPointerCapture) {
      try {
        element.setPointerCapture(id);
        target = element;
      } catch {
        // Use temporary listeners on the window if capture is unavailable.
      }
    }

    drag = {id, target, centerX: left + width / 2, centerY: top + height / 2, radius};
    element.dataset.active = 'true';
    target.addEventListener('pointermove', move, {passive: false});
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    move(event);
  }

  function visibilityChange() {
    if (page.hidden) reset();
  }

  element.addEventListener('pointerdown', begin, {passive: false});
  element.addEventListener('lostpointercapture', end);
  view?.addEventListener('blur', reset);
  view?.addEventListener('resize', reset);
  page.addEventListener('visibilitychange', visibilityChange);

  return {
    reset,
    dispose() {
      reset();
      element.removeEventListener('pointerdown', begin);
      element.removeEventListener('lostpointercapture', end);
      view?.removeEventListener('blur', reset);
      view?.removeEventListener('resize', reset);
      page.removeEventListener('visibilitychange', visibilityChange);
    },
  };
}
