/** Coordinates the nonmodal scene panels without affecting a session or order. */
export function createScenePanels({document: doc = globalThis.document, getView = () => ({})} = {}) {
  const $ = id => doc.getElementById(id);
  const abort = new AbortController();
  const landscape = $('landscape-drawer');
  const landscapeContent = $('landscape-content');
  const landscapeToggle = $('landscape-toggle');
  const landscapeClose = $('landscape-close');
  const rest = $('rest-panel');
  const restToggle = $('rest-toggle');
  const restClose = $('rest-close');
  const restSettings = $('rest-settings');
  const panels = {landscape: {content: landscapeContent, toggle: landscapeToggle, close: landscapeClose},
    rest: {content: rest, toggle: restToggle, close: restClose}};
  let open = null;
  let wasReady = false;
  let openedSeat = null;
  let handledEscape = false;
  let disposed = false;

  function listen(node, event, handler, options = {}) {
    node?.addEventListener(event, handler, {...options, signal: abort.signal});
  }
  const focus = node => node?.focus({preventScroll: true});
  const inside = (node, target) => node === target || Boolean(node?.contains(target));
  const modalOpen = () => Boolean(doc.querySelector('dialog[open]'));
  const available = view => !view.introBlocked && !view.busy;
  const restReady = view => Boolean(view.seated) && available(view);

  function paint(view = getView()) {
    const landscapeOpen = open === 'landscape';
    const restOpen = open === 'rest';
    landscape.dataset.open = String(landscapeOpen);
    landscapeContent.inert = !landscapeOpen;
    landscapeContent.setAttribute('aria-hidden', String(!landscapeOpen));
    landscapeToggle.setAttribute('aria-expanded', String(landscapeOpen));
    landscapeToggle.setAttribute('aria-label', landscapeOpen ? '풍경 설정 닫기' : '풍경 설정 열기');
    restSettings.setAttribute('aria-expanded', String(landscapeOpen));
    rest.dataset.open = String(restOpen);
    rest.inert = !restOpen;
    rest.setAttribute('aria-hidden', String(!restOpen));
    restToggle.setAttribute('aria-expanded', String(restOpen));
    restToggle.setAttribute('aria-label', restOpen ? '휴식 창 닫기' : '휴식 창 열기');
    restToggle.hidden = !restReady(view);
    doc.body.classList.toggle('landscape-open', landscapeOpen);
    doc.body.classList.toggle('rest-open', restOpen);
  }

  function setOpen(next, {focusClose = false, focusToggle = false, restoreFocus = true} = {}) {
    if (disposed) return false;
    const view = getView();
    if (next && (!available(view) || modalOpen() || (next === 'rest' && !restReady(view)))) return false;
    if (next === open) return true;

    const previous = panels[open];
    const incoming = panels[next];
    if (previous && inside(previous.content, doc.activeElement)) {
      // Move focus before making the former panel inert. A native dialog owns
      // its focus when closeAll() is used as a preflight for showModal().
      if (incoming) focus(incoming.toggle);
      else if (restoreFocus && available(view) && (open !== 'rest' || restReady(view))) focus(previous.toggle);
    }
    open = next;
    openedSeat = open === 'rest' ? view.seatId ?? null : null;
    paint(view);
    if (focusClose) focus(incoming?.close ?? incoming?.toggle);
    else if (focusToggle) focus(incoming?.toggle);
    return true;
  }
  function setLandscapeOpen(value, options) {
    return !value && open !== 'landscape' ? !disposed : setOpen(value ? 'landscape' : null, options);
  }
  function setRestOpen(value, options) {
    return !value && open !== 'rest' ? !disposed : setOpen(value ? 'rest' : null, options);
  }
  function closeAll({restoreFocus = false} = {}) {
    return setOpen(null, {restoreFocus});
  }
  function update() {
    if (disposed) return;
    const view = getView();
    const isReady = restReady(view);
    const seat = view.seatId ?? null;
    if (open && (!available(view) || modalOpen())) closeAll();
    else if (open === 'rest' && (!isReady || seat !== openedSeat)) closeAll({restoreFocus: isReady});
    if (isReady !== wasReady) restToggle.hidden = !isReady;
    wasReady = isReady;
  }

  listen(landscapeToggle, 'click', event => setLandscapeOpen(open !== 'landscape', {focusClose: event.detail === 0}));
  listen(landscapeClose, 'click', () => setLandscapeOpen(false));
  listen(restToggle, 'click', event => setRestOpen(open !== 'rest', {focusClose: event.detail === 0}));
  listen(restClose, 'click', () => setRestOpen(false));
  listen(restSettings, 'click', event => setLandscapeOpen(true, {
    focusClose: event.detail === 0,
    focusToggle: event.detail !== 0,
  }));
  listen(doc, 'pointerdown', event => {
    if (open !== 'rest' || event.defaultPrevented || modalOpen()) return;
    if ([landscape, landscapeToggle, rest, restToggle].some(node => inside(node, event.target))) return;
    closeAll({restoreFocus: true});
  }, {capture: true});
  listen(doc, 'keydown', event => {
    if (event.key !== 'Escape') return;
    if (!event.repeat) handledEscape = false;
    if (event.defaultPrevented || !available(getView())) return;
    if (modalOpen()) {
      handledEscape = true;
      return;
    }
    if (!open && !handledEscape) return;
    event.preventDefault();
    event.stopPropagation();
    handledEscape = true;
    closeAll({restoreFocus: true});
  }, {capture: true});

  paint();
  update();
  return {update, closeAll, setLandscapeOpen, setRestOpen,
    get state() {return {landscapeOpen: open === 'landscape', restOpen: open === 'rest'};},
    dispose() {if (!disposed) {abort.abort(); disposed = true;}}};
}
