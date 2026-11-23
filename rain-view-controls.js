const HOVER_INTERVAL = 75;
const TAP_DISTANCE = 6;

/** Pointer/keyboard presentation for the existing window geometry controller. */
export function createRainViewControls({
  canvas,
  panel,
  closeButton,
  windowView,
  getCamera,
  getFloor,
  canTarget,
  isRaining,
  startTransition,
  isBusy,
  onChange,
  reducedMotion = false,
  document: doc = globalThis.document,
}) {
  const listeners = [];
  let selected = null;
  let highlighted = null;
  let pending = null;
  let pointer = null;
  let gesture = null;
  let signature = null;
  let lastHover = -Infinity;
  let savedCanvas = null;
  let escapeHeld = false;
  let returnQueued = false;
  let disposed = false;

  function listen(node, type, handler, options) {
    if (!node?.addEventListener) return;
    node.addEventListener(type, handler, options);
    listeners.push(() => node.removeEventListener(type, handler, options));
  }

  function setHighlight(pane) {
    if (highlighted === pane) return;
    highlighted = pane;
    windowView.setHighlight(pane);
    if (pane) canvas.dataset.rainWindowHover = pane.name || 'true';
    else delete canvas.dataset.rainWindowHover;
  }

  function clearHover(immediate = false) {
    signature = null;
    setHighlight(null);
    if (immediate) windowView.clearHighlight();
  }

  function clearPointer(immediate = false) {
    pointer = null;
    clearHover(immediate);
    if (selected && !reducedMotion) windowView.setParallaxTarget(null);
  }

  function restoreAttribute(name, value) {
    if (value === null) canvas.removeAttribute(name);
    else canvas.setAttribute(name, value);
  }

  function paint() {
    panel.hidden = !selected;
    panel.setAttribute('aria-hidden', String(!selected));
    closeButton.disabled = Boolean(pending);
    doc.body.classList.toggle('rain-viewing', Boolean(selected));
    if (selected) {
      canvas.dataset.rainWindowMode = 'viewing';
      canvas.setAttribute('tabindex', '-1');
      canvas.setAttribute('aria-label', '창문에 맺힌 빗물을 감상하고 있어요. 돌아가기 또는 Escape로 이전 위치로 돌아갑니다.');
    } else {
      delete canvas.dataset.rainWindowMode;
      if (savedCanvas) {
        restoreAttribute('tabindex', savedCanvas.tabindex);
        restoreAttribute('aria-label', savedCanvas.label);
        savedCanvas = null;
      }
    }
  }

  function focusAfterTransition() {
    if (disposed || isBusy()) return;
    pending = null;
    if (returnQueued && selected) {
      returnQueued = false;
      requestClose();
      return;
    }
    returnQueued = false;
    paint();
    (selected ? closeButton : canvas).focus({preventScroll: true});
  }

  function begin(pane, sourceCamera) {
    if (disposed || pending || isBusy()) return false;
    const transition = {pane, swapped: false, cancelled: false};
    pending = transition;
    clearHover(true);
    paint();
    let accepted;
    try {
      accepted = startTransition(() => {
        if (disposed || pending !== transition) return;
        transition.swapped = true;
        if (transition.cancelled) return;
        if (pane) {
          if (!isRaining() || windowView.focus(pane, sourceCamera) === false) return;
          pointer = null;
          savedCanvas = {tabindex: canvas.getAttribute('tabindex'), label: canvas.getAttribute('aria-label')};
        }
        selected = pane;
        paint();
        onChange?.(pane);
      });
    } catch (error) {
      if (pending === transition) pending = null;
      paint();
      throw error;
    }
    if (!accepted) {
      if (pending === transition) pending = null;
      paint();
      return false;
    }
    return true;
  }

  function requestClose() {
    if (disposed) return;
    if (pending) {
      if (pending.pane && !pending.swapped) pending.cancelled = true;
      else if (selected) returnQueued = true;
      return;
    }
    if (selected) begin(null);
  }

  function normalizedPoint(clientX, clientY) {
    const bounds = canvas.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0) ||
        !Number.isFinite(clientX) || !Number.isFinite(clientY) ||
        clientX < bounds.left || clientX > bounds.left + bounds.width ||
        clientY < bounds.top || clientY > bounds.top + bounds.height) return null;
    return {x: (clientX - bounds.left) / bounds.width * 2 - 1,
      y: 1 - (clientY - bounds.top) / bounds.height * 2};
  }

  function pick(ndc) {
    if (disposed || selected || pending || isBusy() || !canTarget() || doc.hidden || !ndc) return null;
    const camera = getCamera();
    camera?.updateMatrixWorld?.();
    const pane = windowView.pick(camera, ndc, getFloor());
    return pane ? {pane, camera} : null;
  }

  function activate(ndc) {
    const hit = pick(ndc);
    return hit ? begin(hit.pane, hit.camera) : false;
  }

  function update(timestamp, delta) {
    if (disposed) return;
    if (pending && !isBusy()) {
      if (pending.swapped) focusAfterTransition();
      else {pending = null; returnQueued = false; paint();}
    }
    if (selected) {
      if (!pending && !isRaining()) requestClose();
      if (!reducedMotion && !doc.hidden) windowView.advanceParallax(delta);
      return;
    }
    if (pending || isBusy() || !canTarget() || doc.hidden) {
      clearHover(true);
      return;
    }
    if (!pointer || gesture?.distance > TAP_DISTANCE) {
      clearHover();
      return;
    }
    const now = Number.isFinite(timestamp) ? timestamp : performance.now();
    if (now - lastHover < HOVER_INTERVAL) return;
    lastHover = now;
    const ndc = normalizedPoint(pointer.x, pointer.y);
    if (!ndc) {clearHover(); return;}
    const camera = getCamera();
    camera?.updateMatrixWorld?.();
    const next = [camera, getFloor(), ndc.x, ndc.y,
      ...(camera?.matrixWorld?.elements ?? []), ...(camera?.projectionMatrix?.elements ?? [])];
    if (signature && next.length === signature.length && next.every((value, index) => value === signature[index])) return;
    signature = next;
    setHighlight(windowView.pick(camera, ndc, getFloor()) ?? null);
  }

  function pointerMove(event) {
    if (selected) {
      if (!reducedMotion && !pending && !isBusy() && !doc.hidden &&
          event.target === canvas && event.pointerType === 'mouse') {
        windowView.setParallaxTarget(normalizedPoint(event.clientX, event.clientY));
      }
      return;
    }
    if (gesture && event.pointerId === gesture.id) {
      gesture.distance += Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y);
      gesture.x = event.clientX;
      gesture.y = event.clientY;
    }
    if (event.pointerType === 'mouse' && (event.target === canvas || gesture?.id === event.pointerId)) {
      pointer = {x: event.clientX, y: event.clientY};
    }
  }

  function pointerEnd(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const current = gesture;
    gesture = null;
    const distance = current.distance + Math.hypot(event.clientX - current.x, event.clientY - current.y);
    if (event.type === 'pointerup' && distance <= TAP_DISTANCE) activate(normalizedPoint(event.clientX, event.clientY));
    if (current.type === 'touch') {pointer = null; clearHover();}
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  listen(canvas, 'pointerdown', event => {
    if (event.isPrimary === false) {gesture = null; return;}
    if (event.button !== 0 || selected || pending || isBusy() || !canTarget()) return;
    if (event.pointerType === 'mouse') pointer = {x: event.clientX, y: event.clientY};
    gesture = {id: event.pointerId, x: event.clientX, y: event.clientY,
      type: event.pointerType, distance: 0};
  });
  listen(doc, 'pointermove', pointerMove, {capture: true, passive: true});
  listen(doc, 'pointerup', pointerEnd, {capture: true});
  listen(doc, 'pointercancel', pointerEnd, {capture: true});
  listen(canvas, 'pointerleave', () => clearPointer());
  listen(closeButton, 'click', requestClose);
  listen(doc, 'keydown', event => {
    const key = event.key || event.code;
    if (key === 'Escape' && (selected || pending || escapeHeld)) {
      consume(event);
      if (!escapeHeld) {escapeHeld = true; requestClose();}
      return;
    }
    if (key !== 'Enter' || event.repeat || event.defaultPrevented ||
        event.ctrlKey || event.metaKey || event.altKey || doc.activeElement !== canvas) return;
    if (activate({x: 0, y: 0})) consume(event);
  }, {capture: true});
  listen(doc, 'keyup', event => {if ((event.key || event.code) === 'Escape') escapeHeld = false;}, {capture: true});
  listen(doc, 'visibilitychange', () => {gesture = null; clearPointer(true); escapeHeld = false;});
  listen(doc.defaultView, 'blur', () => {gesture = null; clearPointer(true); escapeHeld = false;});

  function reset() {
    if (disposed) return;
    pending = null;
    returnQueued = false;
    gesture = null;
    pointer = null;
    const changed = Boolean(selected);
    selected = null;
    clearHover(true);
    paint();
    if (changed) onChange?.(null);
  }

  paint();
  return {
    get pane() {return selected;},
    get active() {return Boolean(selected || pending);},
    get highlighted() {return highlighted;},
    update,
    focusAfterTransition,
    reset,
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      listeners.forEach(remove => remove());
      listeners.length = 0;
    },
  };
}
