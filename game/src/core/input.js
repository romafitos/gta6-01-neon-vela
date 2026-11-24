// Keyboard and mouse state. Gameplay reads `down`, `pressed` (this frame) and mouse deltas.
export function createInput(canvas) {
  const input = {
    down: new Set(),
    pressed: new Set(),
    released: new Set(),
    mouseDX: 0, mouseDY: 0, wheel: 0,
    mouseX: 0, mouseY: 0,
    fire: false, firePressed: false,
    locked: false,
    enabled: true,
  };
  const block = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1']);

  window.addEventListener('keydown', (e) => {
    if (block.has(e.code)) e.preventDefault();
    if (!input.down.has(e.code)) input.pressed.add(e.code);
    input.down.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    input.down.delete(e.code);
    input.released.add(e.code);
  });
  window.addEventListener('blur', () => { input.down.clear(); input.fire = false; });
  let lastX = null, lastY = null;
  window.addEventListener('mousemove', (e) => {
    // With pointer lock, movementX/Y are the raw deltas; without it (some browsers and
    // automation refuse the lock) fall back to the change in cursor position.
    let dx = e.movementX || 0, dy = e.movementY || 0;
    if (!input.locked && !dx && !dy && lastX !== null) { dx = e.clientX - lastX; dy = e.clientY - lastY; }
    lastX = e.clientX; lastY = e.clientY;
    input.mouseDX += dx;
    input.mouseDY += dy;
    input.mouseX = e.clientX; input.mouseY = e.clientY;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { input.fire = true; input.firePressed = true; }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; });
  window.addEventListener('wheel', (e) => { input.wheel += Math.sign(e.deltaY); }, { passive: true });
  document.addEventListener('pointerlockchange', () => { input.locked = document.pointerLockElement === canvas; });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  input.requestLock = () => {
    if (input.locked || !canvas.requestPointerLock) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* headless browsers may refuse pointer lock; mouse deltas still work */ }
  };
  input.isDown = (...codes) => codes.some((c) => input.down.has(c));
  input.wasPressed = (...codes) => codes.some((c) => input.pressed.has(c));
  input.wasReleased = (...codes) => codes.some((c) => input.released.has(c));
  input.endFrame = () => {
    input.pressed.clear(); input.released.clear();
    input.mouseDX = 0; input.mouseDY = 0; input.wheel = 0; input.firePressed = false;
  };
  return input;
}
