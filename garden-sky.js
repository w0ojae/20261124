const vertexShader = `
varying vec3 vSkyDirection;

void main() {
  vSkyDirection = position;
  // Strip camera translation so walking and puddle reflection both see the
  // same sky in world directions. Keep it beyond the mirror's oblique clip.
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position.z = gl_Position.w;
}
`;

const fragmentShader = `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uCloudColor;
uniform float uCloudAmount;
varying vec3 vSkyDirection;

float skyHash(vec2 coordinate) {
  vec3 seed = fract(vec3(coordinate.xyx) * 0.1031);
  seed += dot(seed, seed.yzx + 33.33);
  return fract((seed.x + seed.y) * seed.z);
}

float cloudField(vec2 coordinate) {
  vec2 cell = floor(coordinate);
  vec2 blend = fract(coordinate);
  blend = blend * blend * (3.0 - 2.0 * blend);
  return mix(
    mix(skyHash(cell), skyHash(cell + vec2(1.0, 0.0)), blend.x),
    mix(skyHash(cell + vec2(0.0, 1.0)), skyHash(cell + vec2(1.0)), blend.x),
    blend.y
  );
}

void main() {
  vec3 direction = normalize(vSkyDirection);
  float altitude = max(direction.y, 0.0);
  float altitudeBlend = smoothstep(0.0, 0.87, sqrt(altitude));
  vec3 color = mix(uHorizon, uZenith, altitudeBlend);
  if (uCloudAmount > 0.0 && altitude > 0.025) {
    vec2 cloudUV = direction.xz * vec2(2.3, 3.7) / (0.29 + altitude * 1.55);
    float clouds = smoothstep(0.29, 0.79, cloudField(cloudUV));
    float band = smoothstep(0.025, 0.22, altitude) * (1.0 - smoothstep(0.60, 0.98, altitude));
    color = mix(color, uCloudColor, clouds * band * uCloudAmount);
  }
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

const fraction = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Draw a texture-free sky inside the ordinary scene and its existing captures. */
export function createGardenSky(THREE, scene) {
  const clearTop = new THREE.Color(0xa7c3d0);
  const cloudyTop = new THREE.Color(0x879eab);
  const rainTop = new THREE.Color(0x668597);
  const twilightTop = new THREE.Color(0x81929f);
  const clearNightTop = new THREE.Color(0x162b3d);
  const rainNightTop = new THREE.Color(0x0d2335);
  const dayCloud = new THREE.Color(0xc4d5d9);
  const rainCloud = new THREE.Color(0xa5b8c3);
  const nightCloud = new THREE.Color(0x29465a);
  const nightTop = new THREE.Color();
  const uniforms = {
    uHorizon: { value: new THREE.Color(0xe6e9d9) },
    uZenith: { value: clearTop.clone() },
    uCloudColor: { value: dayCloud.clone() },
    uCloudAmount: { value: 0 },
  };
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.ShaderMaterial({
    name: 'Garden sky gradient',
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Garden sky';
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.userData.outline = false;
  mesh.raycast = () => {};
  // The opaque outline geometry depth-tests without writing depth. Draw the
  // sky ahead of it to keep silhouette pixels against the backdrop.
  mesh.renderOrder = -1000;
  scene.add(mesh);

  let disposed = false;
  function update({ horizon, twilight, night, cloudiness, rain }) {
    if (disposed) return;
    const clouds = fraction(cloudiness), wet = fraction(rain), dark = fraction(night);
    if (horizon?.isColor) uniforms.uHorizon.value.copy(horizon);
    nightTop.copy(clearNightTop).lerp(rainNightTop, wet);
    uniforms.uZenith.value.copy(clearTop).lerp(cloudyTop, clouds).lerp(rainTop, wet)
      .lerp(twilightTop, fraction(twilight) * (0.64 - 0.44 * wet)).lerp(nightTop, dark);
    uniforms.uCloudColor.value.copy(dayCloud).lerp(rainCloud, wet).lerp(nightCloud, dark);
    uniforms.uCloudAmount.value = (0.22 * clouds + 0.10 * wet) * (1 - 0.42 * dark);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    mesh.removeFromParent();
    geometry.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}
