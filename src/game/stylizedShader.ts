import * as THREE from 'three';

export interface StylizeMaterialOptions {
  rimStrength?: number;
  celBoost?: number;
  shadowTintStrength?: number;
}

/**
 * Patches a MeshStandardMaterial with Unreal Engine 5-inspired Stylized Cartoon PBR shading:
 * - Dual-tone crisp cel lighting contrast preserving PBR normals, shadows & textures
 * - Lumen-style cool violet-indigo sky-bounce in shadows + warm oak ground-bounce fill
 * - Crisp stylized Fresnel sky-rim light & metallic specular pop
 */
export function stylizeMaterial(
  mat: THREE.Material | null | undefined,
  opts: StylizeMaterialOptions = {}
): void {
  if (!mat) return;
  if (!(mat instanceof THREE.MeshStandardMaterial)) return;
  if (mat instanceof THREE.MeshPhysicalMaterial) return; // Keep physical glass untouched
  if (mat.transparent) return;
  if (mat.userData.ue5Stylized) return;

  const rimStrength = opts.rimStrength ?? 0.44;
  const celBoost = opts.celBoost ?? 0.62;
  const shadowTintStrength = opts.shadowTintStrength ?? 0.46;

  mat.userData.ue5Stylized = true;
  mat.customProgramCacheKey = () =>
    `ue5-stylized-v4-${rimStrength.toFixed(2)}-${celBoost.toFixed(2)}-${shadowTintStrength.toFixed(2)}`;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimStrength = { value: rimStrength };
    shader.uniforms.uCelBoost = { value: celBoost };
    shader.uniforms.uShadowTint = { value: shadowTintStrength };

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform float uRimStrength;
      uniform float uCelBoost;
      uniform float uShadowTint;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      // UE5 + Hand-Painted Stylized Cartoon PBR Pass v4
      vec3 ueViewDir = normalize(vViewPosition);
      float ueNdotV = clamp(dot(normal, ueViewDir), 0.0, 1.0);
      float ueFresnel = pow(1.0 - ueNdotV, 2.5);
      float ueTopMask = smoothstep(-0.35, 0.72, normal.y) * 0.68 + 0.32;

      // Crisp 3-band stylized cartoon cel ramp preserving PBR shadows
      float ueDirectLum = dot(reflectedLight.directDiffuse, vec3(0.299, 0.587, 0.114));
      float ueAlbedoLum = max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.05);
      float ueLightRatio = clamp(ueDirectLum / ueAlbedoLum, 0.0, 2.2);
      float ueMidBand = smoothstep(0.06, 0.21, ueLightRatio);
      float ueHighBand = smoothstep(0.50, 0.84, ueLightRatio);
      float ueCelBand = ueMidBand * 0.78 + ueHighBand * 0.36;
      vec3 ueDirectStylized = mix(
        reflectedLight.directDiffuse,
        reflectedLight.directDiffuse * (0.70 + 0.62 * ueCelBand),
        uCelBoost
      );

      // Lumen-inspired cool violet-indigo sky-bounce in shadows + warm oak bounce underneath
      float ueShadowMask = 1.0 - clamp(ueMidBand, 0.0, 1.0);
      vec3 ueLumenBounce = diffuseColor.rgb * vec3(0.18, 0.17, 0.42) * ueShadowMask * uShadowTint;
      float ueGroundBounceMask = clamp(-normal.y, 0.0, 1.0) * 0.38;
      vec3 ueGroundBounce = diffuseColor.rgb * vec3(0.28, 0.18, 0.11) * ueGroundBounceMask * uShadowTint;
      vec3 ueWarmLift = ueDirectStylized * vec3(1.08, 1.02, 0.93);

      // Crisp stylized specular highlight pop
      float ueSpecLum = length(totalSpecular);
      vec3 ueStylizedSpec = totalSpecular + totalSpecular * smoothstep(0.08, 0.44, ueSpecLum) * 0.42;

      // View-dependent silhouette sky-rim + golden key-rim
      vec3 ueRimCol = mix(vec3(0.45, 0.74, 1.0), vec3(1.0, 0.92, 0.68), clamp(ueCelBand, 0.0, 1.0));
      vec3 ueRimLight = ueRimCol * (ueFresnel * ueTopMask * uRimStrength) * (0.42 + 0.58 * diffuseColor.rgb);

      outgoingLight = ueWarmLift + reflectedLight.indirectDiffuse + ueLumenBounce + ueGroundBounce + ueStylizedSpec + ueRimLight + totalEmissiveRadiance;
      #include <opaque_fragment>
      `
    );
  };
  mat.needsUpdate = true;
}

/**
 * Traverses an Object3D and upgrades all opaque MeshStandardMaterials with UE5 stylized shading.
 */
export function applyStylizedShaderToObject(
  root: THREE.Object3D,
  opts: StylizeMaterialOptions = {}
): void {
  root.traverse((obj) => {
    if (obj.userData.isOutline || obj.userData.skipStylize) return;
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => stylizeMaterial(m, opts));
      } else {
        stylizeMaterial(mesh.material, opts);
      }
    }
  });
}

// Cache geometries that already have smoothed outline normals baked into aOutlineNormal
const _outlineGeoCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function getGeometryWithSmoothOutlineNormals(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = _outlineGeoCache.get(src);
  if (cached) return cached;

  const posAttr = src.getAttribute('position');
  const normAttr = src.getAttribute('normal');
  if (!posAttr || !normAttr) {
    return src;
  }

  const geo = src.clone();
  const count = posAttr.count;
  const buckets = new Map<string, [number, number, number]>();

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const key = `${Math.round(x * 1000)}_${Math.round(y * 1000)}_${Math.round(z * 1000)}`;
    const nx = normAttr.getX(i);
    const ny = normAttr.getY(i);
    const nz = normAttr.getZ(i);
    const acc = buckets.get(key);
    if (acc) {
      acc[0] += nx;
      acc[1] += ny;
      acc[2] += nz;
    } else {
      buckets.set(key, [nx, ny, nz]);
    }
  }

  const outNormals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(posAttr.getX(i) * 1000)}_${Math.round(posAttr.getY(i) * 1000)}_${Math.round(posAttr.getZ(i) * 1000)}`;
    const acc = buckets.get(key)!;
    const len = Math.hypot(acc[0], acc[1], acc[2]) || 1;
    outNormals[i * 3] = acc[0] / len;
    outNormals[i * 3 + 1] = acc[1] / len;
    outNormals[i * 3 + 2] = acc[2] / len;
  }

  geo.setAttribute('aOutlineNormal', new THREE.BufferAttribute(outNormals, 3));
  _outlineGeoCache.set(src, geo);
  return geo;
}

const _outlineMatCache = new Map<string, THREE.ShaderMaterial>();

function getCartoonOutlineMaterial(width: number, colorHex: number): THREE.ShaderMaterial {
  const key = `${width.toFixed(4)}_${colorHex}`;
  const existing = _outlineMatCache.get(key);
  if (existing) return existing;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uWidth: { value: width },
      uColor: { value: new THREE.Color(colorHex) },
    },
    vertexShader: `
      attribute vec3 aOutlineNormal;
      uniform float uWidth;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vec3 viewNormal = normalize(normalMatrix * aOutlineNormal);
        float distScale = clamp(-mvPosition.z * 0.14, 0.35, 2.6);
        mvPosition.xyz += viewNormal * (uWidth * distScale);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: true,
  });

  _outlineMatCache.set(key, mat);
  return mat;
}

/**
 * Adds a seamless inverted-hull stylized cartoon ink outline around characters and hero props.
 * Uses averaged spatial normals extruded in view space so hard-edged BoxGeometries never crack at corners.
 */
export function addCartoonOutline(
  root: THREE.Object3D,
  width = 0.024,
  colorHex = 0x1b1210
): void {
  const targets: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (obj.userData.isOutline || obj.userData.skipOutline) return;
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      if (m.material instanceof THREE.Material && m.material.transparent) return;
      if (m.material instanceof THREE.MeshStandardMaterial && m.material.emissiveIntensity > 0.35) return;
      if (m.material instanceof THREE.MeshBasicMaterial) return;
      if (m.geometry instanceof THREE.PlaneGeometry || m.geometry instanceof THREE.CircleGeometry) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      if (m.geometry.boundingSphere && m.geometry.boundingSphere.radius < 0.065) return;
      targets.push(m);
    }
  });

  const outlineMat = getCartoonOutlineMaterial(width, colorHex);
  for (const mesh of targets) {
    const geo = getGeometryWithSmoothOutlineNormals(mesh.geometry);
    if (!geo.getAttribute('aOutlineNormal')) continue;
    const shell = new THREE.Mesh(geo, outlineMat);
    shell.name = `${mesh.name || 'mesh'}-outline`;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.userData.isOutline = true;
    mesh.add(shell);
  }
}

/**
 * Creates a UE5-inspired painterly cartoon Sky Dome with multi-layered billowing clouds,
 * golden silver-lining cloud rims, and warm atmospheric sun scattering.
 */
export type StylizedSkyDomeUniforms = {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uZenithCol: { value: THREE.Color };
  uMidCol: { value: THREE.Color };
  uHorizonCol: { value: THREE.Color };
  uGroundCol: { value: THREE.Color };
};

export function createStylizedSkyDome(sunDirection: THREE.Vector3): {
  mesh: THREE.Mesh;
  uniforms: StylizedSkyDomeUniforms;
} {
  const uniforms: StylizedSkyDomeUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDirection.clone().normalize() },
    uZenithCol: { value: new THREE.Color(0.16, 0.44, 0.80) },
    uMidCol: { value: new THREE.Color(0.38, 0.70, 0.95) },
    uHorizonCol: { value: new THREE.Color(0.92, 0.82, 0.66) },
    uGroundCol: { value: new THREE.Color(0.42, 0.50, 0.40) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uZenithCol;
      uniform vec3 uMidCol;
      uniform vec3 uHorizonCol;
      uniform vec3 uGroundCol;
      varying vec3 vWorldDir;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise2D(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise2D(p);
          p *= 2.04;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        vec3 sunNorm = normalize(uSunDir);
        float sunDot = max(dot(dir, sunNorm), 0.0);
        float h = clamp(dir.y, -0.22, 1.0);

        // Stylized UE5 per-house sky gradient
        vec3 zenithCol = uZenithCol;
        vec3 midSkyCol = uMidCol;
        vec3 horizonCol = mix(uHorizonCol, vec3(1.0, 0.86, 0.62), pow(sunDot, 2.0) * 0.55);
        vec3 groundCol = uGroundCol;

        vec3 sky = mix(horizonCol, midSkyCol, smoothstep(0.0, 0.32, max(h, 0.0)));
        sky = mix(sky, zenithCol, smoothstep(0.26, 0.86, max(h, 0.0)));
        if (h < 0.0) {
          sky = mix(horizonCol, groundCol, smoothstep(0.0, -0.22, h));
        }

        // Layered billowing painterly clouds with sunlit silver-lining rims
        if (dir.y > 0.015) {
          vec2 cloudUv1 = dir.xz / (dir.y + 0.24) * 1.35 + vec2(uTime * 0.012, uTime * 0.004);
          vec2 cloudUv2 = dir.xz / (dir.y + 0.34) * 2.1 - vec2(uTime * 0.008, -uTime * 0.006);
          float n1 = fbm(cloudUv1);
          float n2 = fbm(cloudUv2);
          float nCombined = n1 * 0.72 + n2 * 0.28;

          float horizonFade = smoothstep(0.015, 0.19, dir.y);
          float cloudMask = smoothstep(0.49, 0.63, nCombined) * horizonFade;
          float rimBand = smoothstep(0.48, 0.56, nCombined) * (1.0 - smoothstep(0.58, 0.68, nCombined));

          vec3 cloudShadow = mix(vec3(0.70, 0.78, 0.92), uMidCol, 0.35);
          vec3 cloudLit = mix(vec3(1.0, 0.97, 0.92), uHorizonCol + vec3(0.15, 0.10, 0.04), pow(sunDot, 2.5) * 0.55);
          vec3 cloudCol = mix(cloudShadow, cloudLit, smoothstep(0.51, 0.75, nCombined));
          cloudCol += vec3(1.0, 0.88, 0.64) * rimBand * (0.22 + 0.55 * pow(sunDot, 4.0));

          sky = mix(sky, cloudCol, cloudMask * 0.88);
        }

        // Warm sun disc & atmospheric bloom halo
        float halo = pow(sunDot, 10.0) * 0.36 + pow(sunDot, 56.0) * 0.42;
        float disc = smoothstep(0.9962, 0.9985, sunDot);
        sky += vec3(1.0, 0.84, 0.52) * halo;
        sky = mix(sky, vec3(1.0, 0.97, 0.88), disc);

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  const geo = new THREE.SphereGeometry(210, 32, 20);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.skipStylize = true;
  mesh.userData.skipOutline = true;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/**
 * Custom post-processing ShaderPass for Unreal Engine 5 stylized grading:
 * - Warm golden highlights / cool indigo shadows split-toning
 * - Crisp vibrance & filmic contrast curve
 * - Dynamic stealth crouch vignette + danger chase crimson pulse
 */
export const UE5PostColorShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDanger: { value: 0 },
    uVignette: { value: 0.28 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDanger;
    uniform float uVignette;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 col = texel.rgb;

      // Stylized vibrance lift without oversaturating already-vivid surfaces
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      float maxCh = max(col.r, max(col.g, col.b));
      float minCh = min(col.r, min(col.g, col.b));
      float sat = maxCh - minCh;
      col = mix(vec3(luma), col, 1.0 + (1.0 - sat) * 0.24);

      // UE5-style warm sunlit highlights & cool violet-blue shadow split-tone
      vec3 shadowTint = vec3(0.94, 0.96, 1.07);
      vec3 highlightTint = vec3(1.05, 1.01, 0.95);
      col *= mix(shadowTint, highlightTint, smoothstep(0.14, 0.86, luma));

      // Crisp stylized S-curve contrast pop
      vec3 curved = col * col * (3.0 - 2.0 * clamp(col, 0.0, 1.0));
      col = mix(col, curved, 0.22);

      // Edge vignette (strengthens smoothly when crouching / hidden)
      vec2 centered = vUv - 0.5;
      float dist = length(centered) * 1.414;
      float vig = smoothstep(0.56, 1.32, dist);
      col *= 1.0 - vig * uVignette;

      // Danger crimson edge pulse during chase / low HP
      if (uDanger > 0.01) {
        float pulse = 0.72 + 0.28 * sin(uTime * 6.5);
        float edgeMask = smoothstep(0.45, 1.15, dist) * uDanger * pulse;
        col = mix(col, vec3(0.88, 0.14, 0.10), edgeMask * 0.36);
      }

      gl_FragColor = vec4(max(col, 0.0), texel.a);
    }
  `,
};

/**
 * Creates a soft volumetric god-ray light shaft shader for windows & doorways.
 */
export function createSunbeamMaterial(colorHex = 0xffe4a8, opacity = 0.17): {
  material: THREE.ShaderMaterial;
  uniforms: { uTime: { value: number }; uColor: { value: THREE.Color }; uOpacity: { value: number } };
} {
  const uniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(colorHex) },
    uOpacity: { value: opacity },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;

      void main() {
        float along = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.12, vUv.y);
        float sideFade = sin(vUv.x * 3.14159265);
        sideFade = pow(max(sideFade, 0.0), 1.45);
        float facing = pow(abs(dot(normalize(vNormalView), normalize(vViewDir))), 1.15);

        float streak = 0.82 + 0.18 * sin(vUv.x * 16.0 + uTime * 0.7) * cos(vUv.y * 6.0 - uTime * 0.45);
        float alpha = along * sideFade * facing * streak * uOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  return { material, uniforms };
}

/**
 * Creates GPU-animated floating dust motes drifting inside sunbeams & cozy rooms.
 */
export function createSunbeamDustMotes(regions: Array<{ min: THREE.Vector3; max: THREE.Vector3; count: number }>): {
  points: THREE.Points;
  uniforms: { uTime: { value: number } };
} {
  let total = 0;
  for (const r of regions) total += r.count;

  const positions = new Float32Array(total * 3);
  const phases = new Float32Array(total);
  const sizes = new Float32Array(total);

  let idx = 0;
  for (const r of regions) {
    for (let i = 0; i < r.count; i++) {
      positions[idx * 3] = THREE.MathUtils.lerp(r.min.x, r.max.x, Math.random());
      positions[idx * 3 + 1] = THREE.MathUtils.lerp(r.min.y, r.max.y, Math.random());
      positions[idx * 3 + 2] = THREE.MathUtils.lerp(r.min.z, r.max.z, Math.random());
      phases[idx] = Math.random() * Math.PI * 2;
      sizes[idx] = 0.75 + Math.random() * 1.15;
      idx++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uniforms = { uTime: { value: 0 } };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.45 + aPhase) * 0.45;
        p.y += cos(uTime * 0.35 + aPhase * 1.3) * 0.32;
        p.z += sin(uTime * 0.40 + aPhase * 0.7) * 0.45;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float dist = max(-mvPosition.z, 1.0);
        gl_PointSize = clamp((36.0 * aSize) / dist, 1.5, 11.0);
        vAlpha = (0.35 + 0.45 * (0.5 + 0.5 * sin(uTime * 1.3 + aPhase * 2.0))) * smoothstep(70.0, 8.0, dist);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float r = length(c);
        if (r > 0.5) discard;
        float glow = smoothstep(0.5, 0.05, r);
        gl_FragColor = vec4(1.0, 0.92, 0.70, glow * vAlpha);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.userData.skipStylize = true;
  points.userData.skipOutline = true;
  points.frustumCulled = false;
  return { points, uniforms };
}
