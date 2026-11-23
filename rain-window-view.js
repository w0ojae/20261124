// Window interaction uses the existing five shared panes as its exact regions.
// The exterior camera and hover geometry never alter the walking camera or GLB.
const HIGHLIGHT_DURATION = .15;

export function createRainWindowView(THREE, {panes = [], blockers = [], reducedMotion = false} = {}) {
  const registry = new Map([
    ['1F right', {floor: 1, frame: 'Plane091', material: 'Material028'}],
    // The wet panes extend behind the broad sill at authored y=4.62417.
    // Their hover rectangles stop above that sill instead of crossing the counter.
    ['2F right', {floor: 2, frame: 'Cube195', material: 'Material026', bottomInset: .161}],
    ['2F front', {floor: 2, frame: 'Cube195', material: 'Material026', bottomInset: .151}],
    ['2F rear large', {floor: 2, frame: 'Cube195', material: 'Material026'}],
    ['2F rear small', {floor: 2, frame: 'Cube195', material: 'Material026'}],
  ]);
  const metadata = new Map();
  for (const pane of panes) {
    const name = pane.name?.replace(/^Outer glass — /u, '');
    if (registry.has(name)) metadata.set(pane, registry.get(name));
  }
  const scene = new THREE.Scene();
  scene.name = 'Rain window hover perimeter';
  const camera = new THREE.PerspectiveCamera(68, 1, .025, 150);
  const focusOrigin = new THREE.Vector3();
  const parallaxTarget = new THREE.Vector3(), parallaxOffset = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const paneCenter = new THREE.Vector3(), normal = new THREE.Vector3();
  const localPoint = new THREE.Vector3(), direction = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3(), worldBox = new THREE.Box3();
  const boxHit = new THREE.Vector3(), cssSize = new THREE.Vector2(1, 1);
  const opaque = [], visited = new Set();
  const normalizedName = value => String(value ?? '').replace(/[^a-z0-9]/giu, '');
  const eligibleMaterial = material => material?.visible !== false && material &&
    !material.transparent && (material.opacity ?? 1) >= .98 && !material.transmission;
  const roots = Array.isArray(blockers) ? blockers : [blockers];
  for (const root of roots) root?.traverse?.(mesh => {
    if (visited.has(mesh)) return;
    visited.add(mesh);
    if (!mesh.isMesh || metadata.has(mesh) || !mesh.geometry?.attributes?.position ||
        mesh.userData.modelOutline || mesh.userData.rainVisibilityProbe ||
        mesh.userData.groundReflectionProbe) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some(eligibleMaterial)) return;
    mesh.geometry.computeBoundingBox();
    opaque.push({mesh, bounds: mesh.geometry.boundingBox.clone()});
  });
  let disposed = false;
  let highlightTarget = null, highlightPane = null, highlightProgress = 0;

  const positions = [], starts = [], ends = [], corners = [], indices = [];
  for (let edge = 0; edge < 4; edge++) {
    const first = edge * 4;
    for (const [along, side] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
      positions.push(0, 0, 0); starts.push(0, 0, 0); ends.push(0, 0, 0); corners.push(along, side);
    }
    indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('edgeStart', new THREE.Float32BufferAttribute(starts, 3));
  geometry.setAttribute('edgeEnd', new THREE.Float32BufferAttribute(ends, 3));
  geometry.setAttribute('edgeCorner', new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    name: 'White outer window perimeter',
    uniforms: {cssSize: {value: cssSize}, nearPlane: {value: .025}, highlightOpacity: {value: 0}},
    vertexShader: `
      attribute vec3 edgeStart;
      attribute vec3 edgeEnd;
      attribute vec2 edgeCorner;
      uniform vec2 cssSize;
      uniform float nearPlane;
      varying float edgeVisible;
      void main() {
        vec4 a = modelViewMatrix * vec4(edgeStart, 1.0);
        vec4 b = modelViewMatrix * vec4(edgeEnd, 1.0);
        float nearZ = -max(nearPlane, .00001);
        edgeVisible = 1.0;
        if (a.z > nearZ && b.z > nearZ) {
          edgeVisible = 0.0;
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        } else {
          if (a.z > nearZ) a = mix(a, b, (nearZ - a.z) / (b.z - a.z));
          else if (b.z > nearZ) b = mix(b, a, (nearZ - b.z) / (a.z - b.z));
          vec4 clipA = projectionMatrix * a;
          vec4 clipB = projectionMatrix * b;
          vec2 delta = (clipB.xy / clipB.w - clipA.xy / clipA.w) * cssSize;
          vec4 clip = mix(clipA, clipB, edgeCorner.x);
          float edgeLength = length(delta);
          if (edgeLength > .00001) {
            vec2 perpendicular = vec2(-delta.y, delta.x) / edgeLength;
            clip.xy += perpendicular * edgeCorner.y * 2.5 / max(cssSize, vec2(1.0)) * clip.w;
          } else edgeVisible = 0.0;
          gl_Position = clip;
        }
      }`,
    fragmentShader: `varying float edgeVisible;
      uniform float highlightOpacity;
      void main() { if (edgeVisible < .5) discard; gl_FragColor = vec4(vec3(1.0), highlightOpacity); }`,
    depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    transparent: true, forceSinglePass: true,
  });
  const outline = new THREE.Mesh(geometry, material);
  outline.name = 'Four outer window edges';
  outline.frustumCulled = false;
  outline.matrixAutoUpdate = false;
  outline.visible = false;
  outline.onBeforeRender = (renderer, _scene, activeCamera) => {
    renderer.getSize(cssSize);
    material.uniforms.nearPlane.value = activeCamera.near;
  };
  scene.add(outline);

  function paneBasis(pane) {
    pane.updateWorldMatrix(true, false);
    pane.getWorldPosition(paneCenter);
    normalMatrix.getNormalMatrix(pane.matrixWorld);
    normal.set(0, 0, 1).applyMatrix3(normalMatrix).normalize();
  }
  function visible(mesh, viewCamera) {
    if (!mesh.layers.test(viewCamera.layers)) return false;
    for (let object = mesh; object; object = object.parent) if (!object.visible) return false;
    return true;
  }
  function mullion(hit, pane) {
    const info = metadata.get(pane);
    const hitMaterial = Array.isArray(hit.object.material) ?
      hit.object.material[hit.face?.materialIndex ?? 0] : hit.object.material;
    if (normalizedName(hitMaterial?.name) !== info.material) return false;
    let matched = false;
    for (let object = hit.object; object; object = object.parent) {
      if ([object.name, object.userData?.name].some(name => normalizedName(name) === info.frame)) matched = true;
    }
    if (!matched) return false;
    localPoint.copy(hit.point); pane.worldToLocal(localPoint);
    const {width, height} = pane.geometry.parameters;
    return Math.abs(localPoint.z) < .18 && Math.abs(localPoint.x) <= width / 2 + .01 &&
      Math.abs(localPoint.y) <= height / 2 + .01;
  }
  function occluded(pane, paneDistance, viewCamera) {
    const candidates = [];
    for (const entry of opaque) {
      if (!visible(entry.mesh, viewCamera)) continue;
      entry.mesh.updateWorldMatrix(true, false);
      worldBox.copy(entry.bounds).applyMatrix4(entry.mesh.matrixWorld);
      if (!raycaster.ray.intersectBox(worldBox, boxHit)) continue;
      const near = worldBox.containsPoint(raycaster.ray.origin) ? 0 : boxHit.distanceTo(raycaster.ray.origin);
      if (near <= paneDistance + .0001) candidates.push({mesh: entry.mesh, near});
    }
    // A crowded or unsupported view cannot select a window through unknown depth.
    if (candidates.length > 48) return true;
    candidates.sort((a, b) => a.near - b.near);
    const oldFar = raycaster.far;
    raycaster.far = paneDistance + .0001;
    try {
      for (const {mesh} of candidates) for (const hit of raycaster.intersectObject(mesh, false)) {
        const hitMaterial = Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material;
        if (eligibleMaterial(hitMaterial) && hit.distance < paneDistance - .0001 && !mullion(hit, pane)) return true;
      }
    } finally { raycaster.far = oldFar; }
    return false;
  }
  function pick(viewCamera, ndc, floor) {
    if (disposed || !viewCamera?.isPerspectiveCamera || ![1, 2].includes(floor) ||
        !Number.isFinite(ndc?.x) || !Number.isFinite(ndc?.y) || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
    viewCamera.updateWorldMatrix(true, false);
    raycaster.setFromCamera(ndc, viewCamera);
    raycaster.near = viewCamera.near;
    raycaster.far = viewCamera.far;
    const candidates = [];
    for (const [pane, info] of metadata) {
      if (info.floor !== floor || !visible(pane, viewCamera)) continue;
      paneBasis(pane);
      if (normal.dot(direction.copy(raycaster.ray.origin).sub(paneCenter)) >= -.001) continue;
      // The rainy material is two-sided, but exact picking does not depend on it.
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, paneCenter);
      const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!point) continue;
      const distance = point.distanceTo(raycaster.ray.origin);
      if (distance < viewCamera.near || distance > viewCamera.far) continue;
      localPoint.copy(point); pane.worldToLocal(localPoint);
      const {width, height} = pane.geometry.parameters;
      if (Math.abs(localPoint.x) <= width / 2 && Math.abs(localPoint.y) <= height / 2) candidates.push({pane, distance});
    }
    candidates.sort((a, b) => a.distance - b.distance);
    for (const candidate of candidates) if (!occluded(candidate.pane, candidate.distance, viewCamera)) return candidate.pane;
    return null;
  }
  function setHighlight(pane) {
    if (disposed) return;
    highlightTarget = metadata.has(pane) ? pane : null;
    if (!highlightTarget || highlightPane === highlightTarget) return;
    highlightPane = highlightTarget;
    outline.visible = true;
    pane.updateWorldMatrix(true, false);
    outline.matrix.copy(pane.matrixWorld);
    const {width, height} = pane.geometry.parameters;
    const bottom = -height / 2 + (metadata.get(pane).bottomInset ?? 0);
    const points = [[-width / 2, bottom, 0], [width / 2, bottom, 0],
      [width / 2, height / 2, 0], [-width / 2, height / 2, 0]];
    for (let edge = 0; edge < 4; edge++) for (let vertex = 0; vertex < 4; vertex++) {
      geometry.attributes.edgeStart.setXYZ(edge * 4 + vertex, ...points[edge]);
      geometry.attributes.edgeEnd.setXYZ(edge * 4 + vertex, ...points[(edge + 1) % 4]);
    }
    geometry.attributes.edgeStart.needsUpdate = true;
    geometry.attributes.edgeEnd.needsUpdate = true;
  }
  function clearHighlight() {
    highlightTarget = null;
    highlightPane = null;
    highlightProgress = 0;
    outline.visible = false;
    material.uniforms.highlightOpacity.value = 0;
  }
  function advanceHighlight(delta) {
    if (!highlightPane) return;
    const step = reducedMotion ? 1 : Math.max(0, delta) / HIGHLIGHT_DURATION;
    highlightProgress = THREE.MathUtils.clamp(highlightProgress + (highlightTarget ? step : -step), 0, 1);
    if (!highlightTarget && highlightProgress === 0) {
      clearHighlight();
      return;
    }
    material.uniforms.highlightOpacity.value = THREE.MathUtils.smoothstep(highlightProgress, 0, 1);
  }
  function focus(pane, sourceCamera) {
    if (disposed || !metadata.has(pane) || !sourceCamera?.isPerspectiveCamera) return false;
    paneBasis(pane);
    // Frame the center of the glass, just beyond the deepest outer rim.
    camera.position.copy(paneCenter).addScaledVector(normal, .14);
    camera.lookAt(paneCenter.clone().add(normal));
    focusOrigin.copy(camera.position);
    setParallaxTarget(null);
    camera.fov = sourceCamera.fov;
    camera.aspect = sourceCamera.aspect;
    camera.near = sourceCamera.near;
    camera.far = sourceCamera.far;
    camera.zoom = sourceCamera.zoom;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    clearHighlight();
    return true;
  }
  function setParallaxTarget(point) {
    parallaxTarget.copy(focusOrigin);
    if (!point) return;
    // Move opposite the pointer so the scenery follows it in screen space.
    parallaxOffset.set(-.14 * point.x, -.08 * point.y, 0).applyQuaternion(camera.quaternion);
    parallaxTarget.add(parallaxOffset);
  }
  function advanceParallax(delta) {
    if (!(delta > 0) || camera.position.equals(parallaxTarget)) return;
    camera.position.lerp(parallaxTarget, 1 - Math.exp(-6 * delta));
    if (camera.position.distanceToSquared(parallaxTarget) < 1e-8) camera.position.copy(parallaxTarget);
    camera.updateMatrixWorld(true);
  }
  function resize(aspect) {
    if (disposed || !Number.isFinite(aspect) || aspect <= 0) return;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearHighlight();
    scene.remove(outline);
    geometry.dispose();
    material.dispose();
    opaque.length = 0;
  }
  return {
    get highlightPane() {return highlightPane;},
    get highlightOpacity() {return material.uniforms.highlightOpacity.value;},
    pick, setHighlight, clearHighlight, advanceHighlight, scene, camera, focus,
    setParallaxTarget, advanceParallax, resize, dispose,
  };
}
