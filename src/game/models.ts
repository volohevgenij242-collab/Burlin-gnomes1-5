import * as THREE from 'three';
import { GnomeColorId, ItemCategory } from '../types/game';
import { addCartoonOutline, applyStylizedShaderToObject } from './stylizedShader';
import { TextureLibrary } from './textures';

export function addContactShadow(
  group: THREE.Group,
  radiusX: number,
  radiusZ: number,
  tex: THREE.Texture,
  opacity = 0.45
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(radiusX * 2, radiusZ * 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(geo, mat);
  shadow.position.y = 0.02;
  group.add(shadow);
  return shadow;
}

// ==================== PROCEDURAL SCULPTING HELPERS ====================

/**
 * Builds a seamless curved & tapered tube/cone mesh along a 3D spline
 * using parallel-transport frames (zero Frenet twist flips) — ideal for
 * crooked gnome hats, horns, curved tails, and sculpted sleeves.
 */
function createTaperedSplineMesh(
  curve: THREE.Curve<THREE.Vector3>,
  heightSegs: number,
  radialSegs: number,
  radiusAt: (t: number) => number,
  material: THREE.Material,
  capBase = true,
  capTip = true
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const tangents: THREE.Vector3[] = [];
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= heightSegs; i++) {
    const t = i / heightSegs;
    points.push(curve.getPoint(t));
    tangents.push(curve.getTangent(t).normalize());
  }

  // Initial normal frame perpendicular to tangent[0]
  const ref = Math.abs(tangents[0].x) < 0.85 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  let normal = new THREE.Vector3().crossVectors(tangents[0], ref).normalize();
  let binormal = new THREE.Vector3().crossVectors(tangents[0], normal).normalize();

  for (let i = 0; i <= heightSegs; i++) {
    const t = i / heightSegs;
    if (i > 0) {
      // Parallel transport normal
      const prevT = tangents[i - 1];
      const currT = tangents[i];
      const rotAxis = new THREE.Vector3().crossVectors(prevT, currT);
      const axisLen = rotAxis.length();
      if (axisLen > 1e-5) {
        rotAxis.divideScalar(axisLen);
        const angle = Math.acos(THREE.MathUtils.clamp(prevT.dot(currT), -1, 1));
        normal.applyAxisAngle(rotAxis, angle).normalize();
      }
      binormal = new THREE.Vector3().crossVectors(currT, normal).normalize();
    }

    const r = Math.max(0.004, radiusAt(t));
    const p = points[i];
    for (let j = 0; j <= radialSegs; j++) {
      const u = j / radialSegs;
      const theta = u * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const vx = p.x + (normal.x * cos + binormal.x * sin) * r;
      const vy = p.y + (normal.y * cos + binormal.y * sin) * r;
      const vz = p.z + (normal.z * cos + binormal.z * sin) * r;
      positions.push(vx, vy, vz);
      uvs.push(u, t);
    }
  }

  const stride = radialSegs + 1;
  for (let i = 0; i < heightSegs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, d, b);
      indices.push(d, c, b);
    }
  }

  if (capBase) {
    const baseCenterIdx = positions.length / 3;
    const p0 = points[0];
    positions.push(p0.x, p0.y, p0.z);
    uvs.push(0.5, 0);
    for (let j = 0; j < radialSegs; j++) {
      indices.push(baseCenterIdx, j + 1, j);
    }
  }

  if (capTip) {
    const tipCenterIdx = positions.length / 3;
    const pEnd = points[heightSegs];
    positions.push(pEnd.x, pEnd.y, pEnd.z);
    uvs.push(0.5, 1);
    const rowStart = heightSegs * stride;
    for (let j = 0; j < radialSegs; j++) {
      indices.push(tipCenterIdx, rowStart + j, rowStart + j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createCurvedGnomeHat(opts: {
  hatMat: THREE.Material;
  trimMat: THREE.Material;
  brassMat: THREE.Material;
  accentMat?: THREE.Material;
  scale: number;
  slouchX?: number;
  slouchZ?: number;
  isRoyal?: boolean;
}): THREE.Group {
  const { hatMat, trimMat, brassMat, accentMat, scale, slouchX = 0.14, slouchZ = -0.34, isRoyal = false } = opts;
  const hat = new THREE.Group();

  // Rolled wavy felt brim via LatheGeometry
  const brimPts = [
    new THREE.Vector2(0.28 * scale, -0.02 * scale),
    new THREE.Vector2(0.39 * scale, -0.025 * scale),
    new THREE.Vector2(0.47 * scale, 0.015 * scale),
    new THREE.Vector2(0.46 * scale, 0.068 * scale),
    new THREE.Vector2(0.36 * scale, 0.075 * scale),
    new THREE.Vector2(0.31 * scale, 0.04 * scale),
  ];
  const brim = new THREE.Mesh(new THREE.LatheGeometry(brimPts, 24), hatMat);
  brim.castShadow = true;
  brim.receiveShadow = true;
  hat.add(brim);

  // Slouched crooked hat crown along spline with fabric fold ripples
  const tipPos = new THREE.Vector3(slouchX * scale, 1.06 * scale, slouchZ * scale);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.02 * scale, 0),
    new THREE.Vector3(slouchX * 0.12 * scale, 0.34 * scale, -0.02 * scale),
    new THREE.Vector3(slouchX * 0.48 * scale, 0.68 * scale, slouchZ * 0.42 * scale),
    new THREE.Vector3(slouchX * 0.85 * scale, 0.94 * scale, slouchZ * 0.78 * scale),
    tipPos,
  ]);

  const cone = createTaperedSplineMesh(
    curve,
    18,
    18,
    (t) => {
      const base = 0.355 * scale * Math.pow(1 - t, 0.86);
      const fold = Math.sin(t * Math.PI * 3.1) * 0.022 * scale * (1 - t);
      return Math.max(0.022 * scale, base + fold);
    },
    hatMat
  );
  hat.add(cone);

  // Stitched leather/fabric hatband
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.328 * scale, 0.352 * scale, 0.1 * scale, 20),
    trimMat
  );
  band.position.y = 0.1 * scale;
  hat.add(band);

  // Ornate brass buckle at front
  const buckleOuter = new THREE.Mesh(
    new THREE.BoxGeometry(0.14 * scale, 0.125 * scale, 0.055 * scale),
    brassMat
  );
  buckleOuter.position.set(0, 0.1 * scale, 0.335 * scale);
  const bucklePin = new THREE.Mesh(
    new THREE.BoxGeometry(0.045 * scale, 0.065 * scale, 0.065 * scale),
    trimMat
  );
  bucklePin.position.set(0, 0.1 * scale, 0.342 * scale);
  bucklePin.userData.skipOutline = true;
  hat.add(buckleOuter, bucklePin);

  if (isRoyal && accentMat) {
    // High-Gnome golden laurel ridge + jewel medallion on front
    const crownBand = new THREE.Mesh(
      new THREE.TorusGeometry(0.335 * scale, 0.022 * scale, 8, 22),
      brassMat
    );
    crownBand.rotation.x = Math.PI / 2;
    crownBand.position.y = 0.155 * scale;
    hat.add(crownBand);

    const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.065 * scale, 0), accentMat);
    jewel.position.set(0, 0.17 * scale, 0.345 * scale);
    jewel.userData.skipOutline = true;
    hat.add(jewel);
  }

  // Pom-pom / bell at curved tip
  const pom = new THREE.Mesh(
    new THREE.SphereGeometry(0.062 * scale, 10, 10),
    isRoyal ? brassMat : accentMat ?? trimMat
  );
  pom.position.copy(tipPos);
  pom.userData.skipOutline = true;
  hat.add(pom);

  return hat;
}

function createPointedGnomeBoot(opts: {
  leatherMat: THREE.Material;
  soleMat: THREE.Material;
  cuffMat: THREE.Material;
  brassMat: THREE.Material;
  scale: number;
}): THREE.Group {
  const { leatherMat, soleMat, cuffMat, brassMat, scale } = opts;
  const boot = new THREE.Group();

  // Extruded arched sole + upturned toe profile (side silhouette along Z-Y, extruded along X)
  const soleShape = new THREE.Shape();
  soleShape.moveTo(-0.14 * scale, 0);
  soleShape.lineTo(0.18 * scale, 0);
  soleShape.quadraticCurveTo(0.32 * scale, 0.02 * scale, 0.37 * scale, 0.12 * scale);
  soleShape.lineTo(0.33 * scale, 0.15 * scale);
  soleShape.quadraticCurveTo(0.24 * scale, 0.06 * scale, -0.14 * scale, 0.055 * scale);
  soleShape.closePath();

  const soleGeo = new THREE.ExtrudeGeometry(soleShape, {
    depth: 0.22 * scale,
    bevelEnabled: true,
    bevelThickness: 0.015 * scale,
    bevelSize: 0.015 * scale,
    bevelSegments: 2,
  });
  soleGeo.rotateY(Math.PI / 2);
  soleGeo.translate(-0.11 * scale, 0.015 * scale, 0);
  const sole = new THREE.Mesh(soleGeo, soleMat);
  sole.castShadow = true;
  boot.add(sole);

  // Curved boot upper & curled gnome toe
  const toeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.11 * scale, -0.05 * scale),
    new THREE.Vector3(0, 0.11 * scale, 0.12 * scale),
    new THREE.Vector3(0, 0.14 * scale, 0.27 * scale),
    new THREE.Vector3(0, 0.25 * scale, 0.35 * scale),
  ]);
  const upperFoot = createTaperedSplineMesh(
    toeCurve,
    12,
    12,
    (t) => (0.125 - t * 0.092) * scale,
    leatherMat
  );
  boot.add(upperFoot);

  // Tiny brass toe-bell/cap
  const toeCap = new THREE.Mesh(new THREE.SphereGeometry(0.036 * scale, 8, 8), brassMat);
  toeCap.position.set(0, 0.25 * scale, 0.35 * scale);
  toeCap.userData.skipOutline = true;
  boot.add(toeCap);

  // Ankle shaft + folded cuff
  const ankle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11 * scale, 0.12 * scale, 0.2 * scale, 12),
    leatherMat
  );
  ankle.position.set(0, 0.17 * scale, -0.02 * scale);
  ankle.castShadow = true;
  boot.add(ankle);

  const cuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.132 * scale, 0.12 * scale, 0.075 * scale, 12),
    cuffMat
  );
  cuff.position.set(0, 0.26 * scale, -0.02 * scale);
  boot.add(cuff);

  // Side brass buckle
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03 * scale, 0.055 * scale, 0.06 * scale), brassMat);
  buckle.position.set(0.115 * scale, 0.17 * scale, 0.01 * scale);
  buckle.userData.skipOutline = true;
  boot.add(buckle);

  return boot;
}

function addExpressiveFaceDetails(
  headGroup: THREE.Group,
  opts: {
    scale: number;
    eyeY: number;
    eyeZ: number;
    eyeSpread: number;
    noseY: number;
    noseZ: number;
    earY: number;
    earZ: number;
    headRadius: number;
    irisColor: number;
    skinMat: THREE.Material;
    browMat: THREE.Material;
    noseColor?: number;
    cheekColor?: number;
    pointedEars?: boolean;
    angryBrowTilt?: number;
  }
): void {
  const {
    scale,
    eyeY,
    eyeZ,
    eyeSpread,
    noseY,
    noseZ,
    earY,
    earZ,
    headRadius,
    irisColor,
    skinMat,
    browMat,
    noseColor = 0xd67c6a,
    cheekColor = 0xde8d7b,
    pointedEars = true,
    angryBrowTilt = 0.14,
  } = opts;

  const scleraMat = new THREE.MeshPhysicalMaterial({
    color: 0xfbf8f2,
    roughness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const irisMat = new THREE.MeshStandardMaterial({ color: irisColor, roughness: 0.22, metalness: 0.08 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.15 });
  const catchlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const cheekMat = new THREE.MeshStandardMaterial({ color: cheekColor, roughness: 0.62 });
  const noseMat = new THREE.MeshStandardMaterial({ color: noseColor, roughness: 0.52 });

  // Rosy sculpted cheeks (skip outline so they blend cleanly into face)
  [-1, 1].forEach((side) => {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.105 * scale, 10, 10), cheekMat);
    cheek.scale.set(1.15, 0.78, 0.7);
    cheek.position.set(side * (eyeSpread + 0.05 * scale), eyeY - 0.085 * scale, eyeZ - 0.025 * scale);
    cheek.userData.skipOutline = true;
    headGroup.add(cheek);
  });

  // Expressive Eyes (sclera + iris + pupil + specular catchlight + warm upper eyelid)
  [-1, 1].forEach((side) => {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * eyeSpread, eyeY, eyeZ);

    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.062 * scale, 12, 10), scleraMat);
    sclera.scale.set(0.95, 1.08, 0.72);
    sclera.userData.skipOutline = true;
    eyeGroup.add(sclera);

    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.038 * scale, 10, 10), irisMat);
    iris.scale.set(1, 1.05, 0.45);
    iris.position.set(0, 0, 0.032 * scale);
    iris.userData.skipOutline = true;
    eyeGroup.add(iris);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.022 * scale, 8, 8), pupilMat);
    pupil.scale.set(1, 1, 0.4);
    pupil.position.set(0, 0, 0.044 * scale);
    pupil.userData.skipOutline = true;
    eyeGroup.add(pupil);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.01 * scale, 6, 6), catchlightMat);
    glint.position.set(0.015 * scale, 0.018 * scale, 0.052 * scale);
    glint.userData.skipOutline = true;
    eyeGroup.add(glint);

    // Warm upper eyelid hood
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.068 * scale, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.48),
      skinMat
    );
    lid.scale.set(1.02, 0.95, 0.8);
    lid.rotation.x = -0.35;
    lid.userData.skipOutline = true;
    eyeGroup.add(lid);

    headGroup.add(eyeGroup);

    // Curved arched bushy eyebrow
    const browCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * (eyeSpread - 0.065 * scale), eyeY + 0.075 * scale, eyeZ + 0.02 * scale),
      new THREE.Vector3(side * eyeSpread, eyeY + 0.1 * scale, eyeZ + 0.036 * scale),
      new THREE.Vector3(side * (eyeSpread + 0.07 * scale), eyeY + (0.065 + angryBrowTilt * 0.14) * scale, eyeZ + 0.01 * scale),
    ]);
    const brow = createTaperedSplineMesh(
      browCurve,
      8,
      7,
      (t) => (0.028 - Math.abs(t - 0.45) * 0.022) * scale,
      browMat
    );
    brow.userData.skipOutline = true;
    headGroup.add(brow);
  });

  // Sculpted bulbous nose (bridge + plump tip)
  const bridge = new THREE.Mesh(new THREE.SphereGeometry(0.058 * scale, 10, 8), skinMat);
  bridge.scale.set(0.82, 1.15, 0.95);
  bridge.position.set(0, noseY + 0.04 * scale, noseZ - 0.035 * scale);
  bridge.userData.skipOutline = true;
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.105 * scale, 14, 12), noseMat);
  noseTip.scale.set(1.12, 0.92, 1.05);
  noseTip.position.set(0, noseY, noseZ + 0.025 * scale);
  noseTip.castShadow = true;
  headGroup.add(bridge, noseTip);

  // Ears
  [-1, 1].forEach((side) => {
    if (pointedEars) {
      const earCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * (headRadius - 0.02 * scale), earY, earZ),
        new THREE.Vector3(side * (headRadius + 0.09 * scale), earY + 0.045 * scale, earZ - 0.03 * scale),
        new THREE.Vector3(side * (headRadius + 0.17 * scale), earY + 0.115 * scale, earZ - 0.07 * scale),
      ]);
      const ear = createTaperedSplineMesh(
        earCurve,
        8,
        8,
        (t) => Math.max(0.012 * scale, (0.075 - t * 0.064) * scale),
        skinMat
      );
      headGroup.add(ear);
    } else {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.11 * scale, 10, 10), skinMat);
      ear.scale.set(0.45, 1.1, 0.85);
      ear.position.set(side * (headRadius + 0.01 * scale), earY, earZ);
      headGroup.add(ear);
    }
  });
}

function createLayeredGnomeBeard(opts: {
  beardMat: THREE.Material;
  brassMat?: THREE.Material;
  scale: number;
  lengthScale?: number;
  braided?: boolean;
}): THREE.Group {
  const { beardMat, brassMat, scale, lengthScale = 1.0, braided = false } = opts;
  const beardRoot = new THREE.Group();

  // Twirled curled handlebar mustache
  [-1, 1].forEach((side) => {
    const mustCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.02 * scale, 0.06 * scale),
      new THREE.Vector3(side * 0.1 * scale, 0.01 * scale, 0.07 * scale),
      new THREE.Vector3(side * 0.2 * scale, -0.01 * scale, 0.02 * scale),
      new THREE.Vector3(side * 0.27 * scale, 0.045 * scale, -0.02 * scale),
    ]);
    const must = createTaperedSplineMesh(
      mustCurve,
      10,
      8,
      (t) => Math.max(0.012 * scale, (0.062 - Math.abs(t - 0.28) * 0.068) * scale),
      beardMat
    );
    beardRoot.add(must);
  });

  // Main central beard lock (sculpted layered flow via tapered spline)
  const mainCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.01 * scale, 0.03 * scale),
    new THREE.Vector3(0, -0.22 * scale * lengthScale, 0.06 * scale),
    new THREE.Vector3(0, -0.46 * scale * lengthScale, 0.03 * scale),
    new THREE.Vector3(0, -0.66 * scale * lengthScale, -0.02 * scale),
  ]);
  const mainBeard = createTaperedSplineMesh(
    mainCurve,
    12,
    12,
    (t) => Math.max(0.02 * scale, (0.25 * Math.sin(Math.min(1, t + 0.18) * Math.PI * 0.72) * (1 - t * 0.78)) * scale),
    beardMat
  );
  beardRoot.add(mainBeard);

  // Side cheek/jaw beard tufts so beard wraps smoothly into sideburns
  [-1, 1].forEach((side) => {
    const sideCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.18 * scale, 0.08 * scale, -0.05 * scale),
      new THREE.Vector3(side * 0.19 * scale, -0.14 * scale * lengthScale, 0.01 * scale),
      new THREE.Vector3(side * 0.12 * scale, -0.38 * scale * lengthScale, -0.01 * scale),
    ]);
    const sideLock = createTaperedSplineMesh(
      sideCurve,
      9,
      9,
      (t) => Math.max(0.018 * scale, (0.12 * (1 - t * 0.8)) * scale),
      beardMat
    );
    beardRoot.add(sideLock);

    if (braided && brassMat) {
      const braidCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.11 * scale, -0.1 * scale, 0.05 * scale),
        new THREE.Vector3(side * 0.13 * scale, -0.35 * scale * lengthScale, 0.06 * scale),
        new THREE.Vector3(side * 0.09 * scale, -0.58 * scale * lengthScale, 0.03 * scale),
      ]);
      const braid = createTaperedSplineMesh(
        braidCurve,
        10,
        8,
        (t) => (0.052 + Math.sin(t * Math.PI * 8) * 0.011) * (1 - t * 0.55) * scale,
        beardMat
      );
      beardRoot.add(braid);

      const clamp = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045 * scale, 0.045 * scale, 0.042 * scale, 10),
        brassMat
      );
      clamp.position.set(side * 0.11 * scale, -0.47 * scale * lengthScale, 0.045 * scale);
      clamp.userData.skipOutline = true;
      beardRoot.add(clamp);
    }
  });

  return beardRoot;
}

function createSpikedGnomeClub(scale = 1): THREE.Group {
  const stickGroup = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4322, roughness: 0.84 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x452913, roughness: 0.9 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x8a2e24, roughness: 0.74 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc99c3c, metalness: 0.85, roughness: 0.28 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x9aa2aa, metalness: 0.88, roughness: 0.25 });

  // Gnarled tapered club shaft oriented along +Z (from -0.4 to +0.44)
  const shaftCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0.42 * scale),
    new THREE.Vector3(0.008 * scale, -0.005 * scale, 0.12 * scale),
    new THREE.Vector3(-0.008 * scale, 0.01 * scale, -0.18 * scale),
    new THREE.Vector3(0, 0.015 * scale, -0.44 * scale),
  ]);
  const shaft = createTaperedSplineMesh(
    shaftCurve,
    12,
    10,
    (t) => (0.026 + Math.pow(t, 1.4) * 0.024 + Math.sin(t * 15) * 0.003) * scale,
    woodMat
  );
  stickGroup.add(shaft);

  // Wrapped leather handle grip
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032 * scale, 0.03 * scale, 0.24 * scale, 10),
    leatherMat
  );
  grip.rotation.x = Math.PI / 2;
  grip.position.z = 0.26 * scale;
  stickGroup.add(grip);

  // Pommel cap
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.038 * scale, 10, 8), brassMat);
  pommel.position.z = 0.42 * scale;
  stickGroup.add(pommel);

  // Heavy forged iron collar + rivets near club head
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052 * scale, 0.048 * scale, 0.08 * scale, 10),
    ironMat
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.012 * scale, -0.34 * scale);
  stickGroup.add(collar);

  // End wood knot cap
  const endCap = new THREE.Mesh(new THREE.SphereGeometry(0.05 * scale, 10, 8), darkWoodMat);
  endCap.position.set(0, 0.015 * scale, -0.44 * scale);
  stickGroup.add(endCap);

  // Main forged iron nail/spike
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.024 * scale, 0.16 * scale, 8), ironMat);
  spike.rotation.x = -Math.PI / 2;
  spike.position.set(0, 0.015 * scale, -0.53 * scale);
  stickGroup.add(spike);

  // Cross-driven side iron bolt spike
  const sideSpike = new THREE.Mesh(new THREE.ConeGeometry(0.016 * scale, 0.11 * scale, 6), ironMat);
  sideSpike.rotation.z = -Math.PI / 2;
  sideSpike.position.set(0.065 * scale, 0.012 * scale, -0.34 * scale);
  sideSpike.userData.skipOutline = true;
  stickGroup.add(sideSpike);

  return stickGroup;
}

function createSculptedHand(
  mat: THREE.Material,
  side: -1 | 1,
  scale: number,
  isMitten: boolean,
  cuffMat?: THREE.Material
): THREE.Group {
  const hand = new THREE.Group();

  if (isMitten) {
    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065 * scale, 0.06 * scale, 6, 10), mat);
    palm.rotation.x = Math.PI / 2;
    palm.scale.set(0.95, 1.0, 0.82);
    palm.castShadow = true;
    hand.add(palm);

    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.028 * scale, 0.04 * scale, 4, 8), mat);
    thumb.position.set(-side * 0.055 * scale, 0.025 * scale, -0.02 * scale);
    thumb.rotation.set(0.55, 0, side * 0.45);
    hand.add(thumb);

    if (cuffMat) {
      const cuff = new THREE.Mesh(
        new THREE.TorusGeometry(0.068 * scale, 0.018 * scale, 8, 14),
        cuffMat
      );
      cuff.position.z = 0.065 * scale;
      hand.add(cuff);
    }
  } else {
    // 5-fingered stylized anatomical hand (palm hangs downward from wrist at y = 0)
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.72 * scale, 0.78 * scale, 0.44 * scale), mat);
    palm.position.y = -0.32 * scale;
    palm.castShadow = true;
    hand.add(palm);

    // Rounded heel of palm
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.38 * scale, 10, 8), mat);
    pad.scale.set(1.0, 1.05, 0.68);
    pad.position.y = -0.34 * scale;
    pad.userData.skipOutline = true;
    hand.add(pad);

    // 4 curled fingers
    for (let i = 0; i < 4; i++) {
      const fx = (-0.25 + i * 0.168) * scale;
      const len = (i === 1 || i === 2 ? 0.38 : 0.31) * scale;
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.072 * scale, len, 4, 8), mat);
      finger.position.set(fx, -0.78 * scale, 0.1 * scale);
      finger.rotation.x = -0.38;
      finger.userData.skipOutline = true;
      hand.add(finger);
    }

    // Opposable thumb
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.095 * scale, 0.3 * scale, 4, 8), mat);
    thumb.position.set(-side * 0.42 * scale, -0.45 * scale, 0.24 * scale);
    thumb.rotation.set(-0.4, 0, side * 0.55);
    thumb.userData.skipOutline = true;
    hand.add(thumb);
  }

  return hand;
}

// ==================== 1. FIRST-PERSON GNOME HANDS ====================

export interface HumanRig {
  group: THREE.Group;
  torsoGroup: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  head: THREE.Group;
  alertBadge: THREE.Mesh;
  broomGroup: THREE.Group;
  revolverGroup: THREE.Group;
  rifleGroup: THREE.Group;
  shotgunGroup: THREE.Group;
  muzzleFlash: THREE.Mesh;
  grabHandAnchor: THREE.Object3D;
  shirtMat: THREE.MeshStandardMaterial;
  cardiganMat: THREE.MeshStandardMaterial;
}

export interface GnomeNpcRig {
  group: THREE.Group;
  torsoGroup: THREE.Group;
  headGroup: THREE.Group;
  hatGroup: THREE.Group;
  beard: THREE.Object3D;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
}

export interface FirstPersonHandsRig {
  root: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftMittenMat: THREE.MeshStandardMaterial;
  rightMittenMat: THREE.MeshStandardMaterial;
  stickGroup: THREE.Group;
}

export function createFirstPersonHandsModel(): FirstPersonHandsRig {
  const root = new THREE.Group();

  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x2b4e70, roughness: 0.88 });
  const shirtUnderMat = new THREE.MeshStandardMaterial({ color: 0xddd2bd, roughness: 0.82 });
  const cuffMat = new THREE.MeshStandardMaterial({ color: 0xc99c3c, metalness: 0.45, roughness: 0.45 });
  const leatherStrapMat = new THREE.MeshStandardMaterial({ color: 0x422615, roughness: 0.65 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd9aa3e, metalness: 0.85, roughness: 0.26 });
  const leftMittenMat = new THREE.MeshStandardMaterial({ color: 0xa63329, roughness: 0.78 });
  const rightMittenMat = new THREE.MeshStandardMaterial({ color: 0xa63329, roughness: 0.78 });

  const buildArm = (side: -1 | 1, mittenMat: THREE.MeshStandardMaterial) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.34, -0.32, -0.42);

    // Flared gnome coat forearm via LatheGeometry
    const sleevePts = [
      new THREE.Vector2(0.056, -0.18),
      new THREE.Vector2(0.072, -0.09),
      new THREE.Vector2(0.068, 0.02),
      new THREE.Vector2(0.058, 0.14),
      new THREE.Vector2(0.052, 0.18),
    ];
    const sleeve = new THREE.Mesh(new THREE.LatheGeometry(sleevePts, 14), sleeveMat);
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.z = 0.14;
    arm.add(sleeve);

    // Gold embroidered sleeve trim + leather wrist strap with buckle
    const goldTrim = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.009, 8, 16), cuffMat);
    goldTrim.position.z = -0.02;
    arm.add(goldTrim);

    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.036, 12), leatherStrapMat);
    strap.rotation.x = Math.PI / 2;
    strap.position.z = -0.045;
    arm.add(strap);

    const strapBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.026, 0.016), brassMat);
    strapBuckle.position.set(0, 0.058, -0.045);
    strapBuckle.userData.skipOutline = true;
    arm.add(strapBuckle);

    // Peeking cream linen shirt cuff
    const shirtCuff = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.013, 8, 14), shirtUnderMat);
    shirtCuff.position.z = -0.068;
    arm.add(shirtCuff);

    // Quilted Gnome Mitten (recolored cleanly when gloves upgraded)
    const hand = createSculptedHand(mittenMat, side, 1.05, true, cuffMat);
    hand.position.set(0, 0, -0.14);
    arm.add(hand);

    return arm;
  };

  const leftArm = buildArm(-1, leftMittenMat);
  const rightArm = buildArm(1, rightMittenMat);

  // Ornate spiked gnome club attached to right hand
  const stickGroup = createSpikedGnomeClub(1.02);
  stickGroup.position.set(-0.02, 0.02, -0.22);
  stickGroup.rotation.set(0.18, 0.05, 0);
  stickGroup.visible = false;
  rightArm.add(stickGroup);

  root.add(leftArm, rightArm);
  applyStylizedShaderToObject(root, { rimStrength: 0.42, celBoost: 0.45 });
  addCartoonOutline(root, 0.0085, 0x1a110f);
  return { root, leftArm, rightArm, leftMittenMat, rightMittenMat, stickGroup };
}

// ==================== 2. HIGH-GNOME & BURROW COMPANIONS ====================

export function createHighGnomeModel(
  textures: TextureLibrary,
  opts?: { hatColor?: number; tunicColor?: number; hasStaff?: boolean }
): GnomeNpcRig {
  const g = new THREE.Group();
  const torsoGroup = new THREE.Group();
  g.add(torsoGroup);

  const isRoyal = opts?.hasStaff !== false;
  const clothMat = new THREE.MeshStandardMaterial({
    color: opts?.tunicColor ?? 0x2a4a69,
    roughness: 0.86,
    metalness: 0.04,
  });
  const capeMat = new THREE.MeshStandardMaterial({
    color: isRoyal ? 0x8f221c : 0x5c422c,
    roughness: 0.88,
  });
  const hatMat = new THREE.MeshStandardMaterial({
    color: opts?.hatColor ?? 0xa62c24,
    roughness: 0.8,
    metalness: 0.04,
  });
  const furTrimMat = new THREE.MeshStandardMaterial({ color: 0xe7dfd0, roughness: 0.94 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe3b493, roughness: 0.72 });
  const beardMat = new THREE.MeshStandardMaterial({ color: isRoyal ? 0xefece4 : 0xded6c8, roughness: 0.92 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x3b2315, roughness: 0.62 });
  const soleMat = new THREE.MeshStandardMaterial({ color: 0x1e140e, roughness: 0.9 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a43f, roughness: 0.28, metalness: 0.86 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x59361d, roughness: 0.82 });
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x8ef5e2,
    emissive: 0x3ad4bc,
    emissiveIntensity: 1.55,
    roughness: 0.14,
    metalness: 0.1,
  });

  // Sculpted pointed gnome boots planted flush at y = 0
  [-0.24, 0.24].forEach((x) => {
    const boot = createPointedGnomeBoot({
      leatherMat,
      soleMat,
      cuffMat: clothMat,
      brassMat,
      scale: 1.08,
    });
    boot.position.set(x, 0, 0.02);
    boot.rotation.y = x < 0 ? 0.12 : -0.12;
    g.add(boot);
  });

  // Tailored bell-skirt tunic via LatheGeometry
  const tunicPts = [
    new THREE.Vector2(0.0, 0.24),
    new THREE.Vector2(0.56, 0.24),
    new THREE.Vector2(0.54, 0.45),
    new THREE.Vector2(0.47, 0.7),
    new THREE.Vector2(0.42, 1.0),
    new THREE.Vector2(0.33, 1.18),
    new THREE.Vector2(0.16, 1.24),
    new THREE.Vector2(0.0, 1.24),
  ];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(tunicPts, 20), clothMat);
  torso.castShadow = true;
  torso.receiveShadow = true;
  torsoGroup.add(torso);

  // Tunic hem trim + warm fur/gold collar mantle
  const hemTrim = new THREE.Mesh(new THREE.TorusGeometry(0.545, 0.042, 8, 22), isRoyal ? brassMat : furTrimMat);
  hemTrim.rotation.x = Math.PI / 2;
  hemTrim.position.y = 0.26;
  torsoGroup.add(hemTrim);

  const collarMantle = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.085, 10, 20), isRoyal ? furTrimMat : capeMat);
  collarMantle.rotation.x = Math.PI / 2;
  collarMantle.position.y = 1.16;
  torsoGroup.add(collarMantle);

  if (isRoyal) {
    // Regal flowing back cape + shoulder clasps
    const capeShape = new THREE.Shape();
    capeShape.moveTo(-0.34, 0);
    capeShape.lineTo(0.34, 0);
    capeShape.quadraticCurveTo(0.56, -0.5, 0.62, -0.96);
    capeShape.quadraticCurveTo(0, -1.04, -0.62, -0.96);
    capeShape.quadraticCurveTo(-0.56, -0.5, -0.34, 0);

    const capeGeo = new THREE.ExtrudeGeometry(capeShape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
    });
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.position.set(0, 1.14, -0.34);
    cape.rotation.x = 0.24;
    cape.castShadow = true;
    torsoGroup.add(cape);

    [-0.28, 0.28].forEach((cx) => {
      const clasp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), brassMat);
      clasp.rotation.x = Math.PI / 2;
      clasp.position.set(cx, 1.12, 0.34);
      clasp.userData.skipOutline = true;
      torsoGroup.add(clasp);
    });
  } else {
    // Companion traveler leather cross-strap & satchel
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.032, 8, 22), leatherMat);
    strap.rotation.y = Math.PI / 2;
    strap.rotation.x = 0.55;
    strap.position.set(0, 0.82, 0);
    torsoGroup.add(strap);
  }

  // Wide leather belt + ornate brass buckle + hip pouch + parchment scroll
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.475, 0.495, 0.14, 18), leatherMat);
  belt.position.y = 0.66;
  torsoGroup.add(belt);

  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.08), brassMat);
  buckle.position.set(0, 0.66, 0.47);
  torsoGroup.add(buckle);

  const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), leatherMat);
  pouch.scale.set(0.85, 1.15, 0.72);
  pouch.position.set(-0.46, 0.54, 0.14);
  torsoGroup.add(pouch);

  const scroll = new THREE.Mesh(
    new THREE.CylinderGeometry(0.048, 0.048, 0.36, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8d9b5, roughness: 0.86 })
  );
  scroll.rotation.z = 0.65;
  scroll.rotation.y = 0.4;
  scroll.position.set(0.44, 0.58, 0.12);
  torsoGroup.add(scroll);

  // Head Group (pivots at neck y = 1.24 so head turns smoothly toward player)
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.24, 0);
  torsoGroup.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 20, 16), skinMat);
  head.scale.set(1.03, 0.98, 0.98);
  head.position.y = 0.16;
  head.castShadow = true;
  headGroup.add(head);

  addExpressiveFaceDetails(headGroup, {
    scale: 1.05,
    eyeY: 0.21,
    eyeZ: 0.285,
    eyeSpread: 0.12,
    noseY: 0.14,
    noseZ: 0.32,
    earY: 0.18,
    earZ: -0.02,
    headRadius: 0.33,
    irisColor: isRoyal ? 0x2c7a9b : 0x45753d,
    skinMat,
    browMat: beardMat,
    pointedEars: true,
    angryBrowTilt: isRoyal ? -0.06 : 0.1,
  });

  // Layered flowing beard pivoted cleanly at chin/mouth (animated by GameEngine via beard.rotation.x)
  const beard = createLayeredGnomeBeard({
    beardMat,
    brassMat,
    scale: 1.08,
    lengthScale: isRoyal ? 1.18 : 0.82,
    braided: isRoyal,
  });
  beard.position.set(0, 0.04, 0.27);
  headGroup.add(beard);

  // Curved slouched gnome hat (companions pull brim low over brow like Burglin' Gnomes!)
  const hatGroup = createCurvedGnomeHat({
    hatMat,
    trimMat: leatherMat,
    brassMat,
    accentMat: isRoyal ? crystalMat : brassMat,
    scale: isRoyal ? 1.0 : 1.08,
    slouchX: isRoyal ? 0.1 : -0.14,
    slouchZ: isRoyal ? -0.34 : -0.24,
    isRoyal,
  });
  hatGroup.position.set(0, isRoyal ? 0.33 : 0.22, isRoyal ? 0 : 0.02);
  if (!isRoyal) hatGroup.rotation.x = 0.1;
  headGroup.add(hatGroup);

  // Articulated cuffed arms & sculpted hands (companions wear crisp white rolled undershirt cuffs!)
  const whiteShirtMat = new THREE.MeshStandardMaterial({ color: 0xeee9df, roughness: 0.84 });
  const buildNpcArm = (side: -1 | 1) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.46, 1.08, 0);

    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), clothMat);
    shoulder.scale.set(1.0, 0.88, 1.0);
    arm.add(shoulder);

    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.138, isRoyal ? 0.56 : 0.36, 12),
      clothMat
    );
    sleeve.position.set(side * 0.055, isRoyal ? -0.22 : -0.14, 0.04);
    sleeve.rotation.z = -side * 0.26;
    sleeve.castShadow = true;
    arm.add(sleeve);

    if (!isRoyal) {
      const whiteForearm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.11, 0.22, 12),
        whiteShirtMat
      );
      whiteForearm.position.set(side * 0.11, -0.36, 0.065);
      whiteForearm.rotation.z = -side * 0.26;
      arm.add(whiteForearm);
    }

    const cuff = new THREE.Mesh(
      new THREE.TorusGeometry(0.132, 0.03, 8, 14),
      isRoyal ? brassMat : whiteShirtMat
    );
    cuff.rotation.x = Math.PI / 2;
    cuff.rotation.y = -side * 0.26;
    cuff.position.set(side * 0.12, -0.45, 0.07);
    arm.add(cuff);

    const hand = createSculptedHand(skinMat, side, 0.15, false);
    hand.position.set(side * 0.15, -0.49, 0.08);
    arm.add(hand);

    return arm;
  };

  const leftArm = buildNpcArm(-1);
  const rightArm = buildNpcArm(1);
  torsoGroup.add(leftArm, rightArm);

  if (isRoyal) {
    // Twisted gnarly wooden crystal staff
    const staffCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.2, -1.05, 0.22),
      new THREE.Vector3(0.22, -0.3, 0.26),
      new THREE.Vector3(0.18, 0.35, 0.22),
      new THREE.Vector3(0.24, 0.78, 0.26),
    ]);
    const staffShaft = createTaperedSplineMesh(
      staffCurve,
      16,
      10,
      (t) => 0.044 + t * 0.016 + Math.sin(t * 14) * 0.005,
      woodMat
    );
    rightArm.add(staffShaft);

    // Brass claw cradle holding glowing crystal orb
    const cradleRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 8, 14), brassMat);
    cradleRing.rotation.x = Math.PI / 2;
    cradleRing.position.set(0.24, 0.8, 0.26);
    rightArm.add(cradleRing);

    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.22, 6), brassMat);
      prong.position.set(0.24 + Math.cos(a) * 0.1, 0.9, 0.26 + Math.sin(a) * 0.1);
      prong.rotation.z = -Math.cos(a) * 0.35;
      prong.rotation.x = Math.sin(a) * 0.35;
      rightArm.add(prong);
    }

    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.145, 0), crystalMat);
    crystal.scale.set(0.85, 1.35, 0.85);
    crystal.position.set(0.24, 0.96, 0.26);
    rightArm.add(crystal);
  }

  addContactShadow(g, 0.78, 0.78, textures.contactShadow, 0.5);
  applyStylizedShaderToObject(g, { rimStrength: 0.45, celBoost: 0.46 });
  addCartoonOutline(g, 0.02, 0x1a110f);
  return { group: g, torsoGroup, headGroup, hatGroup, beard, leftArm, rightArm };
}

// ==================== 3. GIANT NEIGHBOR (ХОЗЯИН ДОМА) ====================

export function createGiantHumanModel(textures: TextureLibrary): HumanRig {
  const group = new THREE.Group();

  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x3b444f, roughness: 0.86 });
  const sockMat = new THREE.MeshStandardMaterial({ color: 0xc9b99e, roughness: 0.92 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x8f5d42, roughness: 0.85 });
  const cardiganMat = new THREE.MeshStandardMaterial({ color: 0x4b5c47, roughness: 0.9 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x7d2924, roughness: 0.72 });
  const slipperMat = new THREE.MeshStandardMaterial({ color: 0x632e22, roughness: 0.82 });
  const fleeceMat = new THREE.MeshStandardMaterial({ color: 0xe6dcc8, roughness: 0.96 });
  const soleMat = new THREE.MeshStandardMaterial({ color: 0x221b17, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xdfaf8e, roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0xc8c9ce, roughness: 0.9 });
  const glassesMat = new THREE.MeshStandardMaterial({ color: 0x1e2024, metalness: 0.78, roughness: 0.24 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x2c1b11, roughness: 0.58 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a43f, metalness: 0.82, roughness: 0.28 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5434, roughness: 0.76 });
  const bristleMat = new THREE.MeshStandardMaterial({ color: 0xc4a664, roughness: 0.95 });

  // Left & Right Legs (pivoted at hip y = 8.4, reaching floor y = 0)
  const makeLeg = (xOffset: number) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(xOffset, 8.4, 0);

    // Tapered trousers with knee shape & hem cuff via LatheGeometry
    const pantPts = [
      new THREE.Vector2(0.0, -7.25),
      new THREE.Vector2(0.76, -7.25),
      new THREE.Vector2(0.82, -7.05),
      new THREE.Vector2(0.72, -6.95),
      new THREE.Vector2(0.78, -4.4),
      new THREE.Vector2(0.88, -3.5),
      new THREE.Vector2(1.02, -0.35),
      new THREE.Vector2(0.95, 0.25),
      new THREE.Vector2(0.0, 0.25),
    ];
    const trouser = new THREE.Mesh(new THREE.LatheGeometry(pantPts, 16), pantsMat);
    trouser.castShadow = true;
    trouser.receiveShadow = true;
    legPivot.add(trouser);

    // Cozy ankle sock visible above slipper
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.54, 0.9, 14), sockMat);
    sock.position.y = -7.45;
    legPivot.add(sock);

    // Sculpted cozy moccasin house slipper (ExtrudeGeometry silhouette)
    const slipShape = new THREE.Shape();
    slipShape.moveTo(-0.72, -0.92);
    slipShape.lineTo(0.72, -0.92);
    slipShape.quadraticCurveTo(0.84, 0.25, 0.74, 1.25);
    slipShape.quadraticCurveTo(0, 1.98, -0.74, 1.25);
    slipShape.quadraticCurveTo(-0.84, 0.25, -0.72, -0.92);

    const slipGeo = new THREE.ExtrudeGeometry(slipShape, {
      depth: 0.7,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.1,
      bevelSegments: 3,
    });
    slipGeo.rotateX(Math.PI / 2);
    const slipper = new THREE.Mesh(slipGeo, slipperMat);
    slipper.position.set(0, -7.52, 0.28);
    slipper.castShadow = true;
    slipper.receiveShadow = true;
    legPivot.add(slipper);

    // Rubber tread sole
    const soleGeo = new THREE.ExtrudeGeometry(slipShape, {
      depth: 0.18,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.12,
      bevelSegments: 2,
    });
    soleGeo.rotateX(Math.PI / 2);
    const sole = new THREE.Mesh(soleGeo, soleMat);
    sole.position.set(0, -8.18, 0.28);
    legPivot.add(sole);

    // Plush fleece slipper collar around ankle
    const fleeceCollar = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.18, 10, 18), fleeceMat);
    fleeceCollar.rotation.x = Math.PI / 2;
    fleeceCollar.scale.set(1.0, 1.28, 1.0);
    fleeceCollar.position.set(0, -7.46, 0.05);
    legPivot.add(fleeceCollar);

    return legPivot;
  };

  const leftLeg = makeLeg(-1.25);
  const rightLeg = makeLeg(1.25);
  group.add(leftLeg, rightLeg);

  // Upper body torsoGroup (pivoted at waist y = 8.4)
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 8.4, 0);
  group.add(torsoGroup);

  // Sculpted paunchy grandpa torso via LatheGeometry (uses shirtMat for per-house coloring!)
  const torsoPts = [
    new THREE.Vector2(0.0, -0.25),
    new THREE.Vector2(2.15, -0.25),
    new THREE.Vector2(2.44, 1.1),
    new THREE.Vector2(2.54, 2.3),
    new THREE.Vector2(2.38, 3.8),
    new THREE.Vector2(2.28, 5.2),
    new THREE.Vector2(1.92, 6.05),
    new THREE.Vector2(1.05, 6.28),
    new THREE.Vector2(0.0, 6.28),
  ];
  const belly = new THREE.Mesh(new THREE.LatheGeometry(torsoPts, 20), shirtMat);
  belly.scale.set(1.06, 1.0, 0.88);
  belly.castShadow = true;
  belly.receiveShadow = true;
  torsoGroup.add(belly);

  // Tailored open knit cardigan (cardiganMat): back panel + two sculpted curved front halves + collar shawl
  const cardBack = new THREE.Mesh(new THREE.CylinderGeometry(2.36, 2.52, 5.85, 18, 1, false, Math.PI * 0.45, Math.PI * 1.1), cardiganMat);
  cardBack.scale.set(1.1, 1.0, 0.94);
  cardBack.position.y = 3.05;
  cardBack.castShadow = true;
  torsoGroup.add(cardBack);

  [-1, 1].forEach((side) => {
    const vestPanel = new THREE.Mesh(new THREE.BoxGeometry(1.52, 5.75, 2.5), cardiganMat);
    vestPanel.position.set(side * 1.48, 3.02, 0.55);
    vestPanel.rotation.y = side * -0.14;
    vestPanel.castShadow = true;
    torsoGroup.add(vestPanel);

    // Shoulder cap for clean silhouette
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), cardiganMat);
    shoulder.scale.set(1.1, 0.85, 1.0);
    shoulder.position.set(side * 2.15, 5.45, 0);
    torsoGroup.add(shoulder);

    // Lower cardigan pockets
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.95, 0.14), cardiganMat);
    pocket.position.set(side * 1.45, 1.5, 1.88);
    torsoGroup.add(pocket);
  });

  // Folded red handkerchief peeking from chest pocket
  const hankie = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.46, 4), tieMat);
  hankie.position.set(-1.35, 4.7, 2.02);
  hankie.rotation.z = 0.25;
  hankie.userData.skipOutline = true;
  torsoGroup.add(hankie);

  // Necktie & open shirt collar
  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.42, 3.2, 0.14), tieMat);
  tie.position.set(0, 4.35, 2.16);
  tie.rotation.x = -0.06;
  torsoGroup.add(tie);
  const tieKnot = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 8), tieMat);
  tieKnot.position.set(0, 5.88, 1.98);
  torsoGroup.add(tieKnot);

  [-1, 1].forEach((side) => {
    const collarFlap = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.46, 0.24), shirtMat);
    collarFlap.position.set(side * 0.52, 6.02, 1.65);
    collarFlap.rotation.set(0.3, side * 0.35, side * -0.35);
    torsoGroup.add(collarFlap);
  });

  // Leather belt + brass buckle + jangling hip keyring
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(2.44, 2.48, 0.48, 20), leatherMat);
  belt.scale.set(1.07, 1.0, 0.9);
  belt.position.y = 0.26;
  torsoGroup.add(belt);

  const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.56, 0.22), brassMat);
  beltBuckle.position.set(0, 0.26, 2.24);
  torsoGroup.add(beltBuckle);

  const keyRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 14), brassMat);
  keyRing.position.set(2.58, -0.05, 0.4);
  keyRing.rotation.y = Math.PI / 2;
  torsoGroup.add(keyRing);
  [-0.08, 0.08].forEach((kz, i) => {
    const keyBlade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.12), brassMat);
    keyBlade.position.set(2.58, -0.34, 0.4 + kz);
    keyBlade.rotation.x = i === 0 ? 0.12 : -0.12;
    keyBlade.userData.skipOutline = true;
    torsoGroup.add(keyBlade);
  });

  // 4 brass cardigan buttons
  [1.45, 2.65, 3.85, 4.95].forEach((by) => {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 12), brassMat);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(0.78, by, 2.04);
    btn.userData.skipOutline = true;
    torsoGroup.add(btn);
  });

  // Head group (pivoted at neck y = 6.3 inside torsoGroup)
  const head = new THREE.Group();
  head.position.set(0, 6.3, 0);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 1.08, 0.95, 14), skinMat);
  neck.position.y = 0.35;
  head.add(neck);

  // Sculpted cranium + fuller jaw/chin
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1.64, 22, 18), skinMat);
  skull.scale.set(0.94, 1.08, 0.98);
  skull.position.y = 1.95;
  skull.castShadow = true;
  head.add(skull);

  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 12), skinMat);
  chin.scale.set(1.12, 0.72, 0.95);
  chin.position.set(0, 0.88, 0.56);
  chin.userData.skipOutline = true;
  head.add(chin);

  // Expressive eyes, rosy cheeks, bulbous grandpa nose & ears
  addExpressiveFaceDetails(head, {
    scale: 5.2,
    eyeY: 2.22,
    eyeZ: 1.36,
    eyeSpread: 0.58,
    noseY: 1.78,
    noseZ: 1.58,
    earY: 1.9,
    earZ: -0.05,
    headRadius: 1.54,
    irisColor: 0x3b6d8f,
    skinMat,
    browMat: hairMat,
    noseColor: 0xd4836e,
    cheekColor: 0xdb947e,
    pointedEars: false,
    angryBrowTilt: -0.22,
  });

  // Sweeping curved silver walrus mustache via tapered spline tubes!
  [-1, 1].forEach((side) => {
    const stacheCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.42, 1.62),
      new THREE.Vector3(side * 0.42, 1.38, 1.6),
      new THREE.Vector3(side * 0.86, 1.24, 1.44),
      new THREE.Vector3(side * 1.12, 1.02, 1.22),
    ]);
    const stacheHalf = createTaperedSplineMesh(
      stacheCurve,
      10,
      9,
      (t) => Math.max(0.08, 0.36 * (1 - t * 0.72)),
      hairMat
    );
    head.add(stacheHalf);
  });

  // Side hair + back fringe + wispy crown curl
  [-1.36, 1.36].forEach((x) => {
    const sideHair = new THREE.Mesh(new THREE.SphereGeometry(0.68, 12, 10), hairMat);
    sideHair.scale.set(0.5, 1.15, 1.2);
    sideHair.position.set(x, 2.15, -0.25);
    head.add(sideHair);
  });
  const backHair = new THREE.Mesh(new THREE.SphereGeometry(1.45, 14, 12), hairMat);
  backHair.scale.set(1.02, 0.9, 0.65);
  backHair.position.set(0, 2.05, -0.82);
  head.add(backHair);

  const crownTuftCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 3.65, 0.1),
    new THREE.Vector3(0.12, 4.05, 0.36),
    new THREE.Vector3(0.28, 3.92, 0.66),
  ]);
  const crownTuft = createTaperedSplineMesh(
    crownTuftCurve,
    8,
    7,
    (t) => Math.max(0.04, 0.2 * (1 - t * 0.8)),
    hairMat
  );
  head.add(crownTuft);

  // Thick round horn-rimmed glasses with temple arms reaching to ears & physical glass lenses
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0xd4effa,
    transparent: true,
    opacity: 0.34,
    roughness: 0.06,
    clearcoat: 1.0,
    reflectivity: 0.92,
  });
  [-0.58, 0.58].forEach((x) => {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.068, 10, 20), glassesMat);
    rim.position.set(x, 2.22, 1.56);
    head.add(rim);

    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), lensMat);
    lens.position.set(x, 2.22, 1.57);
    lens.userData.skipOutline = true;
    head.add(lens);

    // Glasses temple arm back to ear
    const sideSign = x < 0 ? -1 : 1;
    const temple = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 1.75), glassesMat);
    temple.position.set(sideSign * 1.15, 2.22, 0.72);
    temple.rotation.y = sideSign * -0.18;
    head.add(temple);
  });
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.055, 8, 12, Math.PI), glassesMat);
  bridge.position.set(0, 2.24, 1.56);
  head.add(bridge);

  // Alert exclamation crystal badge (MUST remain a THREE.Mesh with MeshStandardMaterial!)
  const alertBadge = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.52, 0),
    new THREE.MeshStandardMaterial({ color: 0xf7b938, emissive: 0xf08c24, emissiveIntensity: 1.45, roughness: 0.22 })
  );
  alertBadge.scale.set(0.72, 1.45, 0.72);
  alertBadge.position.set(0, 4.65, 0);
  alertBadge.visible = false;
  head.add(alertBadge);

  torsoGroup.add(head);

  // Articulated Sleeved Arms & Sculpted 5-Fingered Giant Hands (pivoted at shoulder y = 5.4)
  const buildGiantArm = (side: -1 | 1) => {
    const arm = new THREE.Group();
    arm.position.set(side * 2.55, 5.4, 0);

    const sleevePts = [
      new THREE.Vector2(0.0, -4.9),
      new THREE.Vector2(0.56, -4.9),
      new THREE.Vector2(0.52, -4.65),
      new THREE.Vector2(0.62, -2.5),
      new THREE.Vector2(0.72, -0.3),
      new THREE.Vector2(0.58, 0.2),
      new THREE.Vector2(0.0, 0.2),
    ];
    const sleeve = new THREE.Mesh(new THREE.LatheGeometry(sleevePts, 14), cardiganMat);
    sleeve.castShadow = true;
    arm.add(sleeve);

    const shirtCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.35, 12), shirtMat);
    shirtCuff.position.y = -4.95;
    arm.add(shirtCuff);

    const hand = createSculptedHand(skinMat, side, 1.0, false);
    hand.position.y = -5.05;
    arm.add(hand);

    return arm;
  };

  const leftArm = buildGiantArm(-1);
  const grabHandAnchor = new THREE.Object3D();
  grabHandAnchor.position.set(0, -5.4, 0.55);
  leftArm.add(grabHandAnchor);

  const rightArm = buildGiantArm(1);

  // Detailed Broom (default patrol)
  const broomGroup = new THREE.Group();
  const broomStick = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 13.5, 12), woodMat);
  broomStick.position.set(0.2, -4.5, 1.5);
  broomStick.rotation.x = 0.32;
  broomStick.castShadow = true;
  const broomCap = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 8), brassMat);
  broomCap.position.set(0.2, 2.0, -0.62);
  const broomCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.44, 0.55, 12), brassMat);
  broomCollar.position.set(0.2, -10.25, 3.42);
  broomCollar.rotation.x = 0.32;
  const broomWoodBlock = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.46, 0.68), woodMat);
  broomWoodBlock.position.set(0.2, -10.48, 3.5);
  broomWoodBlock.rotation.x = 0.32;
  const broomHead = new THREE.Mesh(new THREE.BoxGeometry(2.75, 1.05, 0.72), bristleMat);
  broomHead.position.set(0.2, -11.1, 3.7);
  broomHead.rotation.x = 0.32;
  broomHead.castShadow = true;
  broomGroup.add(broomStick, broomCap, broomCollar, broomWoodBlock, broomHead);

  // Stylized-realistic firearm materials
  const gunSteelMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.85, roughness: 0.25 });
  const gunDarkMat = new THREE.MeshStandardMaterial({ color: 0x1e2126, metalness: 0.78, roughness: 0.34 });
  const gunWoodMat = new THREE.MeshStandardMaterial({ color: 0x6b3b20, roughness: 0.68 });
  const scopeBrassMat = new THREE.MeshStandardMaterial({ color: 0xc29338, metalness: 0.86, roughness: 0.22 });
  const shellRedMat = new THREE.MeshStandardMaterial({ color: 0xb52b22, roughness: 0.42 });

  // 1. Detailed Six-Shooter Revolver
  const revolverGroup = new THREE.Group();
  revolverGroup.position.set(0, -5.4, 0.2);
  revolverGroup.rotation.x = Math.PI / 2;

  const revGripShape = new THREE.Shape();
  revGripShape.moveTo(-0.22, 0.1);
  revGripShape.lineTo(0.22, 0.1);
  revGripShape.quadraticCurveTo(0.32, -0.55, 0.18, -1.05);
  revGripShape.lineTo(-0.34, -0.95);
  revGripShape.quadraticCurveTo(-0.18, -0.45, -0.22, 0.1);
  const revGripGeo = new THREE.ExtrudeGeometry(revGripShape, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04 });
  revGripGeo.rotateY(Math.PI / 2);
  revGripGeo.translate(-0.17, -0.1, -0.15);
  const revGrip = new THREE.Mesh(revGripGeo, gunWoodMat);
  const revFrame = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.56, 1.4), gunSteelMat);
  revFrame.position.set(0, 0.12, 0.38);
  const revGuard = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 14), gunDarkMat);
  revGuard.rotation.y = Math.PI / 2;
  revGuard.position.set(0, -0.26, 0.45);
  const revCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.82, 14), gunDarkMat);
  revCyl.rotation.x = Math.PI / 2;
  revCyl.position.set(0, 0.22, 0.42);
  const revBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.165, 1.95, 8), gunSteelMat);
  revBarrel.rotation.x = Math.PI / 2;
  revBarrel.position.set(0, 0.3, 1.82);
  const revLug = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 1.7), gunDarkMat);
  revLug.position.set(0, 0.16, 1.72);
  const revHammer = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.22), gunSteelMat);
  revHammer.position.set(0, 0.45, -0.22);
  revHammer.rotation.x = -0.45;
  const revSight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.14), scopeBrassMat);
  revSight.position.set(0, 0.46, 2.66);
  revolverGroup.add(revGrip, revFrame, revGuard, revCyl, revBarrel, revLug, revHammer, revSight);
  revolverGroup.visible = false;

  // 2. Detailed Scoped Hunting Rifle
  const rifleGroup = new THREE.Group();
  rifleGroup.position.set(0, -5.4, 0.25);
  rifleGroup.rotation.x = Math.PI / 2;

  const rifStock = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.88, 3.65), gunWoodMat);
  rifStock.position.set(0, -0.1, 0.3);
  const rifButt = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.92, 0.14), scopeBrassMat);
  rifButt.position.set(0, -0.1, -1.56);
  const rifReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.56, 1.55), gunDarkMat);
  rifReceiver.position.set(0, 0.36, 0.9);
  const rifBolt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), gunSteelMat);
  rifBolt.rotation.z = Math.PI / 2;
  rifBolt.position.set(0.28, 0.4, 0.72);
  const rifBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.14, 4.35, 12), gunSteelMat);
  rifBarrel.rotation.x = Math.PI / 2;
  rifBarrel.position.set(0, 0.42, 3.58);
  const rifScope = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.15, 1.75, 12), scopeBrassMat);
  rifScope.rotation.x = Math.PI / 2;
  rifScope.position.set(0, 0.84, 0.95);
  const rifScopeBell = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.16, 0.42, 12), scopeBrassMat);
  rifScopeBell.rotation.x = Math.PI / 2;
  rifScopeBell.position.set(0, 0.84, 1.92);
  const rifOptic = new THREE.Mesh(new THREE.CircleGeometry(0.21, 14), lensMat);
  rifOptic.position.set(0, 0.84, 2.14);
  rifOptic.userData.skipOutline = true;
  rifleGroup.add(rifStock, rifButt, rifReceiver, rifBolt, rifBarrel, rifScope, rifScopeBell, rifOptic);
  rifleGroup.visible = false;

  // 3. Detailed Double-Barrel Pump Shotgun with Side-Saddle Shells
  const shotgunGroup = new THREE.Group();
  shotgunGroup.position.set(0, -5.4, 0.25);
  shotgunGroup.rotation.x = Math.PI / 2;

  const shStock = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.96, 2.65), gunWoodMat);
  shStock.position.set(0, -0.12, -0.12);
  const shReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.68, 1.65), gunDarkMat);
  shReceiver.position.set(0, 0.3, 1.1);
  [-0.145, 0.145].forEach((bx) => {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.155, 3.45, 12), gunSteelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(bx, 0.42, 3.16);
    shotgunGroup.add(barrel);
  });
  const shPump = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.46, 1.4), gunWoodMat);
  shPump.position.set(0, 0.18, 2.9);
  const shBead = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), scopeBrassMat);
  shBead.position.set(0, 0.59, 4.78);
  shBead.userData.skipOutline = true;
  shotgunGroup.add(shStock, shReceiver, shPump, shBead);

  // Side-saddle shotgun shells
  [0.82, 1.12, 1.42].forEach((sz) => {
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.38, 8), shellRedMat);
    shell.position.set(0.31, 0.32, sz);
    shell.userData.skipOutline = true;
    const brassBase = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.1, 8), scopeBrassMat);
    brassBase.position.set(0.31, 0.14, sz);
    brassBase.userData.skipOutline = true;
    shotgunGroup.add(shell, brassBase);
  });
  shotgunGroup.visible = false;

  // Muzzle Flash at gun tip
  const muzzleFlash = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.58, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd257 })
  );
  muzzleFlash.position.set(0, -9.8, 0.5);
  muzzleFlash.visible = false;

  rightArm.add(broomGroup, revolverGroup, rifleGroup, shotgunGroup, muzzleFlash);

  torsoGroup.add(leftArm, rightArm);
  addContactShadow(group, 2.9, 2.9, textures.contactShadow, 0.45);
  applyStylizedShaderToObject(group, { rimStrength: 0.44, celBoost: 0.48 });
  addCartoonOutline(group, 0.042, 0x1a110f);

  return {
    group,
    torsoGroup,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    head,
    alertBadge,
    broomGroup,
    revolverGroup,
    rifleGroup,
    shotgunGroup,
    muzzleFlash,
    grabHandAnchor,
    shirtMat,
    cardiganMat,
  };
}

// ==================== 4. COCKROACH & SPIDER ====================

export function createInsectModel(
  kind: 'cockroach' | 'spider',
  textures: TextureLibrary
): { group: THREE.Group; bodyGroup: THREE.Group; legs: THREE.Object3D[]; antennae: THREE.Object3D[] } {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);
  const legs: THREE.Object3D[] = [];
  const antennae: THREE.Object3D[] = [];

  if (kind === 'cockroach') {
    const shellMat = new THREE.MeshPhysicalMaterial({
      color: 0x542c15,
      roughness: 0.22,
      metalness: 0.14,
      clearcoat: 0.85,
      clearcoatRoughness: 0.18,
    });
    const darkChitinMat = new THREE.MeshStandardMaterial({ color: 0x2b160a, roughness: 0.55 });
    const wingMat = new THREE.MeshPhysicalMaterial({
      color: 0x704224,
      roughness: 0.32,
      transparent: true,
      opacity: 0.78,
      clearcoat: 0.65,
    });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x110c0a, roughness: 0.18 });

    // Layered segmented abdomen carapace plates
    for (let s = 0; s < 4; s++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(0.36 - s * 0.045, 12, 10), shellMat);
      seg.scale.set(1.02 - s * 0.08, 0.44, 0.95);
      seg.position.set(0, 0.27 - s * 0.01, 0.1 - s * 0.26);
      seg.castShadow = true;
      bodyGroup.add(seg);
    }

    // Folded translucent veined wing covers (elytra)
    [-1, 1].forEach((side) => {
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10), wingMat);
      wing.scale.set(0.55, 0.18, 1.65);
      wing.position.set(side * 0.11, 0.34, -0.2);
      wing.rotation.y = side * -0.06;
      wing.userData.skipOutline = true;
      bodyGroup.add(wing);
    });

    // Shield-like pronotum dome over thorax
    const pronotum = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), shellMat);
    pronotum.scale.set(1.06, 0.48, 0.98);
    pronotum.position.set(0, 0.31, 0.54);
    pronotum.castShadow = true;
    bodyGroup.add(pronotum);

    // Head capsule + compound eyes + mandibles
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), darkChitinMat);
    head.scale.set(1.05, 0.85, 0.95);
    head.position.set(0, 0.24, 0.86);
    bodyGroup.add(head);

    [-0.1, 0.1].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 8), eyeMat);
      eye.position.set(ex, 0.27, 0.94);
      eye.userData.skipOutline = true;
      bodyGroup.add(eye);
    });

    // Curved segmented antennae
    [-1, 1].forEach((side) => {
      const antPivot = new THREE.Group();
      antPivot.position.set(side * 0.07, 0.28, 0.95);
      const antCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(side * 0.14, 0.12, 0.25),
        new THREE.Vector3(side * 0.32, 0.18, 0.52),
        new THREE.Vector3(side * 0.44, 0.08, 0.76),
      ]);
      const ant = createTaperedSplineMesh(antCurve, 8, 6, (t) => 0.018 * (1 - t * 0.65), darkChitinMat);
      antPivot.add(ant);
      bodyGroup.add(antPivot);
      antennae.push(antPivot);
    });

    // 6 articulated 2-segment spiny legs
    for (let i = 0; i < 3; i++) {
      [-1, 1].forEach((side) => {
        const legPivot = new THREE.Group();
        legPivot.position.set(side * 0.28, 0.22, 0.45 - i * 0.36);

        const femur = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.22, 4, 6), darkChitinMat);
        femur.rotation.z = side * -1.05;
        femur.position.set(side * 0.14, 0.04, 0);

        const tibia = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.26, 4, 6), darkChitinMat);
        tibia.rotation.z = side * 0.38;
        tibia.position.set(side * 0.29, -0.09, -0.04 * i);

        legPivot.add(femur, tibia);
        bodyGroup.add(legPivot);
        legs.push(legPivot);
      });
    }
    addContactShadow(group, 0.68, 0.95, textures.contactShadow, 0.42);
  } else {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x221e28, roughness: 0.78 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xb82822, roughness: 0.45 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x18151d, roughness: 0.62 });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xe6352e,
      emissive: 0xa81612,
      emissiveIntensity: 0.65,
      roughness: 0.14,
    });

    // Bulbous spider abdomen with crimson dorsal warning markings & rear spinneret
    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.47, 14, 12), bodyMat);
    abdomen.position.set(0, 0.46, -0.36);
    abdomen.scale.set(1.02, 0.88, 1.18);
    abdomen.castShadow = true;
    bodyGroup.add(abdomen);

    const marking = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), stripeMat);
    marking.scale.set(0.65, 0.25, 1.35);
    marking.position.set(0, 0.84, -0.36);
    marking.userData.skipOutline = true;
    bodyGroup.add(marking);

    const spinneret = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 6), legMat);
    spinneret.rotation.x = -Math.PI / 2;
    spinneret.position.set(0, 0.4, -0.94);
    bodyGroup.add(spinneret);

    // Cephalothorax
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), bodyMat);
    head.scale.set(1.05, 0.82, 1.1);
    head.position.set(0, 0.36, 0.24);
    head.castShadow = true;
    bodyGroup.add(head);

    // 8-eye predator cluster + curved fangs
    const eyeSpecs = [
      { x: -0.075, y: 0.44, z: 0.51, r: 0.052 },
      { x: 0.075, y: 0.44, z: 0.51, r: 0.052 },
      { x: -0.155, y: 0.42, z: 0.46, r: 0.032 },
      { x: 0.155, y: 0.42, z: 0.46, r: 0.032 },
      { x: -0.11, y: 0.5, z: 0.46, r: 0.025 },
      { x: 0.11, y: 0.5, z: 0.46, r: 0.025 },
    ];
    eyeSpecs.forEach((es) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(es.r, 8, 8), eyeMat);
      eye.position.set(es.x, es.y, es.z);
      eye.userData.skipOutline = true;
      bodyGroup.add(eye);
    });

    [-0.08, 0.08].forEach((fx) => {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.16, 6), legMat);
      fang.rotation.x = Math.PI * 0.78;
      fang.position.set(fx, 0.26, 0.5);
      bodyGroup.add(fang);
    });

    // 8 articulated arched 2-segment spider legs
    for (let i = 0; i < 4; i++) {
      [-1, 1].forEach((side) => {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.22, 0.34, 0.28 - i * 0.18);

        const femur = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.36, 4, 8), legMat);
        femur.position.set(side * 0.2, 0.14, 0);
        femur.rotation.z = side * -1.1;

        const tibia = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.44, 4, 8), legMat);
        tibia.position.set(side * 0.43, -0.06, 0);
        tibia.rotation.z = side * 0.18;

        pivot.add(femur, tibia);
        bodyGroup.add(pivot);
        legs.push(pivot);
      });
    }
    addContactShadow(group, 0.72, 0.72, textures.contactShadow, 0.42);
  }

  applyStylizedShaderToObject(bodyGroup, { rimStrength: 0.46, celBoost: 0.45 });
  addCartoonOutline(bodyGroup, 0.013, 0x150e0d);
  return { group, bodyGroup, legs, antennae };
}

// ==================== 5. INTERACTIVE PROPS ====================

export function createPropModel(
  category: ItemCategory,
  textures: TextureLibrary
): { group: THREE.Group; radius: number; halfHeight: number; weight: number } {
  const group = new THREE.Group();
  const finalizeProp = (radius: number, halfHeight: number, weight: number, outlineWidth = 0.014) => {
    applyStylizedShaderToObject(group, { rimStrength: 0.44, celBoost: 0.44 });
    addCartoonOutline(group, outlineWidth, 0x1a110f);
    return { group, radius, halfHeight, weight };
  };

  if (category === 'mug') {
    const ceramicMat = new THREE.MeshPhysicalMaterial({
      color: 0xe3dacb,
      roughness: 0.18,
      metalness: 0.04,
      clearcoat: 0.75,
    });
    const coffeeMat = new THREE.MeshStandardMaterial({ color: 0x2e1a10, roughness: 0.12 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xa63c2b, roughness: 0.35 });

    const points = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.54, 0),
      new THREE.Vector2(0.6, 0.15),
      new THREE.Vector2(0.58, 1.25),
      new THREE.Vector2(0.52, 1.25),
      new THREE.Vector2(0.52, 0.15),
      new THREE.Vector2(0, 0.15),
    ];
    const body = new THREE.Mesh(new THREE.LatheGeometry(points, 20), ceramicMat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.604, 0.604, 0.22, 20, 1, true), stripeMat);
    stripe.position.y = 0.78;
    group.add(stripe);

    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.51, 18), coffeeMat);
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 1.05;
    group.add(coffee);

    const crema = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.47, 18),
      new THREE.MeshStandardMaterial({ color: 0x87542c, roughness: 0.35 })
    );
    crema.rotation.x = -Math.PI / 2;
    crema.position.y = 1.055;
    group.add(crema);

    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 10, 16, Math.PI), ceramicMat);
    handle.rotation.z = -Math.PI / 2;
    handle.position.set(0.58, 0.65, 0);
    handle.castShadow = true;
    group.add(handle);

    group.children.forEach((c) => {
      c.position.y -= 0.62;
    });
    return finalizeProp(0.65, 0.62, 2, 0.016);
  }

  if (category === 'cheese') {
    const cheeseMat = new THREE.MeshStandardMaterial({ map: textures.cheeseRind, roughness: 0.65 });
    const rindMat = new THREE.MeshStandardMaterial({ color: 0xb87b1e, roughness: 0.85 });

    const shape = new THREE.Shape();
    shape.moveTo(-0.7, -0.5);
    shape.lineTo(0.8, 0);
    shape.lineTo(-0.7, 0.5);
    shape.closePath();

    const extrude = new THREE.ExtrudeGeometry(shape, {
      depth: 0.55,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 2,
    });
    extrude.rotateX(-Math.PI / 2);
    extrude.center();
    const mesh = new THREE.Mesh(extrude, cheeseMat);
    mesh.castShadow = true;
    group.add(mesh);

    const rind = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 1.08), rindMat);
    rind.position.set(-0.75, 0, 0);
    group.add(rind);

    return finalizeProp(0.7, 0.34, 2, 0.016);
  }

  if (category === 'battery') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.45, metalness: 0.3 });
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xc87533, roughness: 0.25, metalness: 0.85 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xcfcfd4, roughness: 0.25, metalness: 0.9 });

    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.65, 14), bodyMat);
    lower.position.y = -0.15;
    lower.castShadow = true;
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.242, 0.242, 0.32, 14), copperMat);
    upper.position.y = 0.32;
    upper.castShadow = true;
    const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10), metalMat);
    nub.position.y = 0.52;
    const baseCap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 14), metalMat);
    baseCap.position.y = -0.5;
    group.add(lower, upper, nub, baseCap);
    group.rotation.z = Math.PI / 2;
    return finalizeProp(0.45, 0.26, 1.5, 0.012);
  }

  if (category === 'fork') {
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.22, metalness: 0.92 });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 1.25), steelMat);
    handle.position.z = -0.55;
    handle.castShadow = true;
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.2), steelMat);
    neck.position.z = 0.15;
    group.add(handle, neck);
    [-0.12, -0.04, 0.04, 0.12].forEach((x) => {
      const tine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.52), steelMat);
      tine.position.set(x, 0, 0.48);
      tine.castShadow = true;
      group.add(tine);
    });
    return finalizeProp(0.65, 0.1, 1.2, 0.01);
  }

  if (category === 'spoon') {
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xd0d5da, roughness: 0.2, metalness: 0.92 });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 1.2), steelMat);
    handle.position.z = -0.45;
    handle.castShadow = true;
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), steelMat);
    bowl.scale.set(0.85, 0.35, 1.3);
    bowl.position.z = 0.38;
    bowl.castShadow = true;
    group.add(handle, bowl);
    return finalizeProp(0.6, 0.12, 1.2, 0.01);
  }

  if (category === 'coin') {
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xebb83b, roughness: 0.18, metalness: 0.94 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 20), goldMat);
    disc.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.032, 8, 20), goldMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.04;
    const emblem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 6), goldMat);
    group.add(disc, rim, emblem);
    return finalizeProp(0.38, 0.08, 1, 0.011);
  }

  if (category === 'matchbox') {
    const sleeveMat = new THREE.MeshStandardMaterial({ map: textures.matchboxLabel, roughness: 0.78 });
    const trayMat = new THREE.MeshStandardMaterial({ color: 0xc29e67, roughness: 0.88 });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xb52b22, roughness: 0.6 });

    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.32, 0.65), sleeveMat);
    sleeve.castShadow = true;
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.26, 0.58), trayMat);
    tray.position.x = 0.26;
    group.add(sleeve, tray);

    [-0.12, 0.05, 0.16].forEach((z) => {
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), trayMat);
      stick.position.set(0.55, 0.06, z);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), tipMat);
      tip.position.set(0.8, 0.06, z);
      group.add(stick, tip);
    });
    return finalizeProp(0.55, 0.18, 1, 0.012);
  }

  if (category === 'trashbin') {
    const binMat = new THREE.MeshStandardMaterial({ color: 0x4b5861, roughness: 0.42, metalness: 0.65 });
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x2f373d, roughness: 0.5, metalness: 0.5 });
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xd8d1c2, roughness: 0.9 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.25, 4.2, 16), binMat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.1, 8, 18), lidMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 2.1;
    group.add(rim);

    const lid = new THREE.Mesh(new THREE.CylinderGeometry(1.58, 1.58, 0.25, 16), lidMat);
    lid.position.set(0.2, 2.25, 0);
    lid.rotation.z = -0.18;
    lid.castShadow = true;
    group.add(lid);

    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.16, 0.45), lidMat);
    pedal.position.set(0, -1.9, 1.45);
    group.add(pedal);

    for (let i = 0; i < 3; i++) {
      const trash = new THREE.Mesh(new THREE.DodecahedronGeometry(0.38, 0), paperMat);
      trash.position.set((i - 1) * 0.45, 1.95, (i % 2) * 0.35 - 0.15);
      group.add(trash);
    }

    return finalizeProp(1.55, 2.1, 4, 0.028);
  }

  if (category === 'key') {
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xe2b144, roughness: 0.22, metalness: 0.92 });
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.055, 8, 16), brassMat);
    bow.rotation.x = Math.PI / 2;
    bow.position.set(0, 0, -0.45);
    bow.castShadow = true;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.92, 10), brassMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0, 0.14);
    shaft.castShadow = true;
    const bit1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.12), brassMat);
    bit1.position.set(0.11, 0, 0.48);
    const bit2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.1), brassMat);
    bit2.position.set(0.08, 0, 0.3);
    group.add(bow, shaft, bit1, bit2);
    return finalizeProp(0.55, 0.09, 1, 0.011);
  }

  if (category === 'ring') {
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xf2c649, roughness: 0.16, metalness: 0.95 });
    const gemMat = new THREE.MeshStandardMaterial({
      color: 0xe6294b,
      emissive: 0x99122e,
      emissiveIntensity: 0.75,
      roughness: 0.12,
      metalness: 0.2,
    });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.075, 10, 20), goldMat);
    band.rotation.x = Math.PI / 2;
    band.castShadow = true;
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.12, 8), goldMat);
    bezel.position.set(0, 0.1, 0.34);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), gemMat);
    gem.position.set(0, 0.22, 0.34);
    group.add(band, bezel, gem);
    return finalizeProp(0.42, 0.18, 1, 0.011);
  }

  if (category === 'watch') {
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xdfb143, roughness: 0.2, metalness: 0.92 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xf6efe2, roughness: 0.35 });
    const handMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.3 });
    const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.16, 20), goldMat);
    casing.castShadow = true;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.38, 18), faceMat);
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.085;
    const handH = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.22), handMat);
    handH.position.set(0, 0.095, -0.07);
    const handM = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.28), handMat);
    handM.rotation.y = 1.1;
    handM.position.set(0.11, 0.098, 0.03);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 10), goldMat);
    crown.rotation.x = Math.PI / 2;
    crown.position.set(0, 0, -0.52);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 14), goldMat);
    loop.rotation.x = Math.PI / 2;
    loop.position.set(0, 0, -0.64);
    group.add(casing, face, handH, handM, crown, loop);
    return finalizeProp(0.5, 0.12, 1.2, 0.012);
  }

  if (category === 'apple') {
    const appleMat = new THREE.MeshPhysicalMaterial({
      color: 0xc92c28,
      roughness: 0.26,
      clearcoat: 0.65,
      clearcoatRoughness: 0.2,
    });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5c371c, roughness: 0.85 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4b943a, roughness: 0.72 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.44, 16, 12), appleMat);
    body.scale.set(1.04, 0.92, 1.04);
    body.castShadow = true;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.26, 6), stemMat);
    stem.position.set(0, 0.44, 0);
    stem.rotation.z = 0.18;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), leafMat);
    leaf.scale.set(1.4, 0.25, 0.75);
    leaf.position.set(0.14, 0.48, 0);
    leaf.rotation.z = 0.35;
    group.add(body, stem, leaf);
    return finalizeProp(0.46, 0.41, 1.4, 0.014);
  }

  if (category === 'candle') {
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc99c3c, roughness: 0.26, metalness: 0.86 });
    const waxMat = new THREE.MeshStandardMaterial({ color: 0xf4ecd8, roughness: 0.68 });
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0xffda6b,
      emissive: 0xff8c24,
      emissiveIntensity: 1.7,
      roughness: 0.2,
    });
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.5, 0.12, 16), brassMat);
    saucer.position.y = -0.52;
    saucer.castShadow = true;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 12), brassMat);
    handle.position.set(0.48, -0.44, 0);
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.82, 12), waxMat);
    wax.position.y = -0.05;
    wax.castShadow = true;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 8), flameMat);
    flame.position.y = 0.49;
    group.add(saucer, handle, wax, flame);
    return finalizeProp(0.5, 0.62, 1.4, 0.014);
  }

  if (category === 'vase') {
    const ceramicMat = new THREE.MeshPhysicalMaterial({
      color: 0x3b6c94,
      roughness: 0.18,
      metalness: 0.08,
      clearcoat: 0.8,
    });
    const goldRimMat = new THREE.MeshStandardMaterial({ color: 0xe0b246, roughness: 0.22, metalness: 0.88 });
    const pts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.42, 0),
      new THREE.Vector2(0.68, 0.55),
      new THREE.Vector2(0.64, 1.05),
      new THREE.Vector2(0.3, 1.45),
      new THREE.Vector2(0.42, 1.75),
      new THREE.Vector2(0.36, 1.75),
      new THREE.Vector2(0.24, 1.45),
      new THREE.Vector2(0, 0.2),
    ];
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), ceramicMat);
    body.castShadow = true;
    body.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.05, 8, 18), goldRimMat);
    band.rotation.x = Math.PI / 2;
    body.position.y = -0.88;
    band.position.y = -0.06;
    group.add(body, band);
    return finalizeProp(0.7, 0.88, 2.2, 0.018);
  }

  if (category === 'plate') {
    const porcelainMat = new THREE.MeshPhysicalMaterial({
      color: 0xf0ebe1,
      roughness: 0.16,
      metalness: 0.05,
      clearcoat: 0.85,
    });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2e6499, roughness: 0.35 });
    const pts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.48, 0.02),
      new THREE.Vector2(0.84, 0.16),
      new THREE.Vector2(0.86, 0.2),
      new THREE.Vector2(0.48, 0.08),
      new THREE.Vector2(0, 0.07),
    ];
    const plate = new THREE.Mesh(new THREE.LatheGeometry(pts, 22), porcelainMat);
    plate.castShadow = true;
    plate.receiveShadow = true;
    plate.position.y = -0.1;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.03, 6, 22), rimMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    group.add(plate, ring);
    return finalizeProp(0.86, 0.12, 1.5, 0.014);
  }

  if (category === 'remote') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x242830, roughness: 0.42, metalness: 0.25 });
    const btnRedMat = new THREE.MeshStandardMaterial({ color: 0xd93829, roughness: 0.35 });
    const btnGrayMat = new THREE.MeshStandardMaterial({ color: 0x9fa8b2, roughness: 0.4 });
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x66e8ff, emissive: 0x29b8db, emissiveIntensity: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.18, 1.35), bodyMat);
    body.castShadow = true;
    const pwrBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10), btnRedMat);
    pwrBtn.position.set(-0.1, 0.1, -0.45);
    const irLed = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), ledMat);
    irLed.position.set(0, 0, -0.68);
    group.add(body, pwrBtn, irLed);
    for (let r = 0; r < 3; r++) {
      for (let c = -1; c <= 1; c++) {
        const btn = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.09), btnGrayMat);
        btn.position.set(c * 0.12, 0.1, -0.18 + r * 0.18);
        group.add(btn);
      }
    }
    return finalizeProp(0.68, 0.12, 1.3, 0.012);
  }

  // Default: 'scrap' (brass gear + hex bolt + copper coil)
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc29338, roughness: 0.32, metalness: 0.85 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x8b9299, roughness: 0.35, metalness: 0.88 });
  const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 12), brassMat);
  gear.castShadow = true;
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.22, 6), steelMat);
  nut.position.set(0.15, 0.12, 0);
  const coil = new THREE.Mesh(
    new THREE.TorusGeometry(0.26, 0.05, 8, 14),
    new THREE.MeshStandardMaterial({ color: 0xb86632, roughness: 0.3, metalness: 0.85 })
  );
  coil.rotation.x = Math.PI / 2;
  coil.position.set(-0.18, 0.08, 0.12);
  group.add(gear, nut, coil);
  return finalizeProp(0.45, 0.16, 1, 0.011);
}

// ==================== 6. WORKBENCH & CLIMBABLE CHAIR ====================

export function createWorkbenchModel(textures: TextureLibrary): THREE.Group {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4528, roughness: 0.84 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x452b17, roughness: 0.88 });
  const anvilMat = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.34, metalness: 0.88 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a23b, roughness: 0.28, metalness: 0.86 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xffc864,
    emissive: 0xff9224,
    emissiveIntensity: 1.65,
    roughness: 0.2,
  });
  const potionMat = new THREE.MeshStandardMaterial({
    color: 0x52f2c8,
    emissive: 0x1ea884,
    emissiveIntensity: 1.1,
    roughness: 0.15,
  });

  // 4 turned lathe wooden legs + bottom stretcher bars
  [
    [-1.1, -0.65],
    [1.1, -0.65],
    [-1.1, 0.65],
    [1.1, 0.65],
  ].forEach(([x, z]) => {
    const legPts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.14, 0),
      new THREE.Vector2(0.1, 0.25),
      new THREE.Vector2(0.14, 0.65),
      new THREE.Vector2(0.11, 1.05),
      new THREE.Vector2(0.15, 1.28),
      new THREE.Vector2(0, 1.28),
    ];
    const leg = new THREE.Mesh(new THREE.LatheGeometry(legPts, 10), darkWood);
    leg.position.set(x, 0, z);
    leg.castShadow = true;
    g.add(leg);
  });

  const stretcherL = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.14), darkWood);
  stretcherL.position.set(0, 0.35, -0.65);
  const stretcherR = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.14), darkWood);
  stretcherR.position.set(0, 0.35, 0.65);
  g.add(stretcherL, stretcherR);

  // Heavy chamfered oak tabletop with iron corner brackets
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.2, 1.8), woodMat);
  top.position.y = 1.36;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);

  // Horned blacksmith anvil
  const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.42), anvilMat);
  anvilBase.position.set(-0.62, 1.56, 0);
  const anvilWaist = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.28), anvilMat);
  anvilWaist.position.set(-0.62, 1.72, 0);
  const anvilTop = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.18, 0.36), anvilMat);
  anvilTop.position.set(-0.56, 1.86, 0);
  const anvilHorn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.46, 10), anvilMat);
  anvilHorn.rotation.z = Math.PI / 2;
  anvilHorn.position.set(-1.1, 1.86, 0);
  g.add(anvilBase, anvilWaist, anvilTop, anvilHorn);

  // Hammer + rolled blueprint scroll + enchanted potion vial + brass lantern
  const hammerHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.62, 8), darkWood);
  hammerHandle.rotation.z = Math.PI / 2;
  hammerHandle.rotation.y = 0.4;
  hammerHandle.position.set(0.32, 1.5, 0.28);
  const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.32), anvilMat);
  hammerHead.rotation.y = 0.4;
  hammerHead.position.set(0.54, 1.54, 0.2);

  const blueprint = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 0.02, 0.56),
    new THREE.MeshStandardMaterial({ color: 0x385e82, roughness: 0.85 })
  );
  blueprint.position.set(0.45, 1.47, -0.22);

  const vial = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), potionMat);
  vial.position.set(0.06, 1.59, -0.45);
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.09, 8), woodMat);
  cork.position.set(0.06, 1.74, -0.45);

  const lampStand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.12, 10), brassMat);
  lampStand.position.set(1.06, 1.52, -0.46);
  const lampCap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.16, 8), brassMat);
  lampCap.position.set(1.06, 1.96, -0.46);
  const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), glowMat);
  lamp.position.set(1.06, 1.74, -0.46);

  g.add(hammerHandle, hammerHead, blueprint, vial, cork, lampStand, lampCap, lamp);

  addContactShadow(g, 1.6, 1.05, textures.contactShadow, 0.45);
  applyStylizedShaderToObject(g, { rimStrength: 0.38, celBoost: 0.42 });
  addCartoonOutline(g, 0.018, 0x1a110f);
  return g;
}

export function createChairModel(woodMat: THREE.Material, seatMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc99c3c, metalness: 0.82, roughness: 0.3 });

  // Turned wooden legs matching exact collider bounds (±1.7, height 4.4)
  [
    [-1.7, -1.7],
    [1.7, -1.7],
    [-1.7, 1.7],
    [1.7, 1.7],
  ].forEach(([x, z]) => {
    const legPts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.18, 0),
      new THREE.Vector2(0.24, 0.4),
      new THREE.Vector2(0.16, 1.4),
      new THREE.Vector2(0.25, 2.2),
      new THREE.Vector2(0.17, 3.3),
      new THREE.Vector2(0.24, 4.4),
      new THREE.Vector2(0, 4.4),
    ];
    const leg = new THREE.Mesh(new THREE.LatheGeometry(legPts, 10), woodMat);
    leg.position.set(x, 0, z);
    leg.castShadow = true;
    leg.receiveShadow = true;
    g.add(leg);
  });

  // Cross rungs (parkourable at exact heights!)
  const rungF = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.4, 8), woodMat);
  rungF.rotation.z = Math.PI / 2;
  rungF.position.set(0, 1.7, 1.7);
  const rungS = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.4, 8), woodMat);
  rungS.rotation.x = Math.PI / 2;
  rungS.position.set(1.7, 2.1, 0);
  g.add(rungF, rungS);

  // Beveled upholstered cushion seat (y = 4.35 to 4.8)
  const seatShape = new THREE.Shape();
  seatShape.moveTo(-1.95, -1.95);
  seatShape.lineTo(1.95, -1.95);
  seatShape.lineTo(1.95, 1.95);
  seatShape.lineTo(-1.95, 1.95);
  seatShape.closePath();
  const seatGeo = new THREE.ExtrudeGeometry(seatShape, {
    depth: 0.36,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.12,
    bevelSegments: 2,
  });
  seatGeo.rotateX(Math.PI / 2);
  const seat = new THREE.Mesh(seatGeo, seatMat);
  seat.position.y = 4.76;
  seat.castShadow = true;
  seat.receiveShadow = true;
  g.add(seat);

  // Carved backrest posts, finials, slats & brass corner studs
  [-1.7, 1.7].forEach((x) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 5.5, 10), woodMat);
    post.position.set(x, 7.35, -1.7);
    post.castShadow = true;
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), brassMat);
    finial.position.set(x, 10.22, -1.7);
    g.add(post, finial);
  });
  [6.4, 8.0, 9.65].forEach((y, idx) => {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(3.45, idx === 2 ? 0.8 : 0.52, 0.28),
      woodMat
    );
    slat.position.set(0, y, -1.7);
    slat.castShadow = true;
    g.add(slat);
  });

  applyStylizedShaderToObject(g, { rimStrength: 0.36, celBoost: 0.4 });
  addCartoonOutline(g, 0.025, 0x1c1310);
  return g;
}

// ==================== 7. MULTIPLAYER BURGLAR GNOME AVATAR ====================

export const GNOME_COLOR_PALETTE: Record<
  GnomeColorId,
  { hex: string; hat: number; tunic: number; label: string }
> = {
  red: { hex: '#c43a2d', hat: 0xb53226, tunic: 0x325275, label: 'Красный' },
  blue: { hex: '#3474b8', hat: 0x2c63a6, tunic: 0x3b4963, label: 'Синий' },
  green: { hex: '#3b8c58', hat: 0x35804f, tunic: 0x4b422d, label: 'Зелёный' },
  gold: { hex: '#d49a2a', hat: 0xc98f22, tunic: 0x5c3626, label: 'Золотой' },
  purple: { hex: '#7c4ab8', hat: 0x6f3fa8, tunic: 0x2f3b52, label: 'Фиолетовый' },
  teal: { hex: '#2a948a', hat: 0x248279, tunic: 0x423a35, label: 'Бирюзовый' },
};

export interface RemoteGnomeRig {
  group: THREE.Group;
  bodyRoot: THREE.Group;
  headGroup: THREE.Group;
  hatGroup: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  stickGroup: THREE.Group;
  nameSprite: THREE.Sprite;
  nameTexture: THREE.CanvasTexture;
}

function createNameplateTexture(name: string, _colorHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Clean Burglin' Gnomes floating white text with crisp black outline & zero box frame
  ctx.font = '800 28px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0e0a09';
  ctx.lineWidth = 6.5;
  ctx.strokeText(name.slice(0, 16), 128, 34);

  ctx.fillStyle = '#ffffff';
  ctx.fillText(name.slice(0, 16), 128, 34);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRemoteGnomePlayerModel(
  name: string,
  colorId: GnomeColorId,
  textures: TextureLibrary
): RemoteGnomeRig {
  const palette = GNOME_COLOR_PALETTE[colorId] ?? GNOME_COLOR_PALETTE.red;
  const group = new THREE.Group();
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);

  const hatMat = new THREE.MeshStandardMaterial({ color: palette.hat, roughness: 0.78 });
  const tunicMat = new THREE.MeshStandardMaterial({ color: palette.tunic, roughness: 0.85 });
  const whiteShirtMat = new THREE.MeshStandardMaterial({ color: 0xeee9df, roughness: 0.84 });
  const scarfMat = new THREE.MeshStandardMaterial({ color: palette.hat, roughness: 0.88 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe3b493, roughness: 0.72 });
  const beardMat = new THREE.MeshStandardMaterial({ color: 0xd9cdb8, roughness: 0.9 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x3b2517, roughness: 0.68 });
  const soleMat = new THREE.MeshStandardMaterial({ color: 0x1d130d, roughness: 0.9 });
  const beltMat = new THREE.MeshStandardMaterial({ color: 0x24170f, roughness: 0.62 });
  const packMat = new THREE.MeshStandardMaterial({ color: 0x6e5236, roughness: 0.88 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xcbb486, roughness: 0.92 });
  const steelBuckleMat = new THREE.MeshStandardMaterial({ color: 0xbac2cc, metalness: 0.78, roughness: 0.28 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd1a33f, metalness: 0.82, roughness: 0.28 });
  const lanternGlow = new THREE.MeshStandardMaterial({
    color: 0xffd570,
    emissive: 0xff9f2e,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });

  // Articulated legs with brown burglar boots (planted cleanly at y = 0)
  const makeLeg = (x: number) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(x, 0.34, 0);
    const pant = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.085, 0.2, 10), tunicMat);
    pant.position.y = -0.09;
    legPivot.add(pant);

    const boot = createPointedGnomeBoot({
      leatherMat: bootMat,
      soleMat,
      cuffMat: bootMat,
      brassMat: steelBuckleMat,
      scale: 0.66,
    });
    boot.position.set(0, -0.34, 0);
    legPivot.add(boot);

    return legPivot;
  };
  const leftLeg = makeLeg(-0.15);
  const rightLeg = makeLeg(0.15);
  bodyRoot.add(leftLeg, rightLeg);

  // Tailored flared burglar coat via LatheGeometry
  const torsoPts = [
    new THREE.Vector2(0, 0.26),
    new THREE.Vector2(0.35, 0.26),
    new THREE.Vector2(0.33, 0.42),
    new THREE.Vector2(0.28, 0.66),
    new THREE.Vector2(0.24, 0.84),
    new THREE.Vector2(0.13, 0.9),
    new THREE.Vector2(0, 0.9),
  ];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoPts, 16), tunicMat);
  torso.castShadow = true;
  torso.receiveShadow = true;
  bodyRoot.add(torso);

  // Cozy collar rim
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.055, 8, 16), tunicMat);
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 0.86;
  bodyRoot.add(scarf);

  // Dark leather belt + square brushed steel buckle + hip loot pouch
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.295, 0.31, 0.095, 16), beltMat);
  belt.position.y = 0.5;
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.115, 0.055), steelBuckleMat);
  buckle.position.set(0, 0.5, 0.305);
  const buckleInner = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.055, 0.064), beltMat);
  buckleInner.position.set(0, 0.5, 0.307);
  buckleInner.userData.skipOutline = true;
  const lootPouch = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), packMat);
  lootPouch.scale.set(0.85, 1.15, 0.72);
  lootPouch.position.set(0.29, 0.42, 0.06);
  bodyRoot.add(belt, buckle, buckleInner, lootPouch);

  // Burglar Backpack with coiled rope & glowing mini brass lantern
  const packGroup = new THREE.Group();
  packGroup.position.set(0, 0.64, -0.32);

  const rucksack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 0.22), packMat);
  rucksack.castShadow = true;
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.24), beltMat);
  flap.position.y = 0.15;
  const ropeCoil = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.032, 8, 14), ropeMat);
  ropeCoil.rotation.x = Math.PI / 2;
  ropeCoil.position.set(0, 0.24, 0);
  const miniLantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), lanternGlow);
  miniLantern.position.set(-0.2, -0.05, -0.04);
  packGroup.add(rucksack, flap, ropeCoil, miniLantern);
  bodyRoot.add(packGroup);

  // Expressive Sculpted Head + Thick Beard + Tall Gnome Hat pulled low over the eyes!
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.92, 0);
  bodyRoot.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 14), skinMat);
  head.position.y = 0.1;
  head.castShadow = true;
  headGroup.add(head);

  addExpressiveFaceDetails(headGroup, {
    scale: 0.72,
    eyeY: 0.14,
    eyeZ: 0.19,
    eyeSpread: 0.085,
    noseY: 0.065,
    noseZ: 0.225,
    earY: 0.12,
    earZ: -0.015,
    headRadius: 0.22,
    irisColor: 0x3b7ab8,
    skinMat,
    browMat: beardMat,
    pointedEars: true,
    angryBrowTilt: -0.1,
  });

  const beard = createLayeredGnomeBeard({
    beardMat,
    scale: 0.72,
    lengthScale: 0.92,
    braided: false,
  });
  beard.position.set(0, 0.02, 0.19);
  headGroup.add(beard);

  // Tall curved Burglin' Gnomes hat pulled down low over the eyes/brow
  const hatGroup = createCurvedGnomeHat({
    hatMat,
    trimMat: hatMat,
    brassMat,
    accentMat: hatMat,
    scale: 0.78,
    slouchX: -0.1,
    slouchZ: -0.22,
    isRoyal: false,
  });
  hatGroup.position.set(0, 0.145, 0.015);
  hatGroup.rotation.x = 0.11;
  headGroup.add(hatGroup);

  // Articulated arms: blue tunic upper sleeve + crisp white rolled-up shirt forearm + sculpted skin hands!
  const buildRemoteArm = (side: -1 | 1) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.28, 0.82, 0);

    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), tunicMat);
    const upperSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.084, 0.2, 10), tunicMat);
    upperSleeve.position.y = -0.1;
    upperSleeve.castShadow = true;

    const cuffRoll = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.022, 6, 12), whiteShirtMat);
    cuffRoll.rotation.x = Math.PI / 2;
    cuffRoll.position.y = -0.2;

    const whiteForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.074, 0.17, 10), whiteShirtMat);
    whiteForearm.position.y = -0.28;
    whiteForearm.castShadow = true;

    const hand = createSculptedHand(skinMat, side, 0.1, false);
    hand.position.set(0, -0.36, 0.01);

    arm.add(shoulder, upperSleeve, cuffRoll, whiteForearm, hand);
    return arm;
  };

  const leftArm = buildRemoteArm(-1);
  const rightArm = buildRemoteArm(1);
  bodyRoot.add(leftArm, rightArm);

  // Detailed spiked gnome club mounted on right arm
  const stickGroup = createSpikedGnomeClub(0.84);
  stickGroup.rotation.y = Math.PI;
  stickGroup.position.set(0, -0.38, 0.36);
  stickGroup.visible = false;
  rightArm.add(stickGroup);

  // Floating Nameplate
  const nameTexture = createNameplateTexture(name, palette.hex);
  const spriteMat = new THREE.SpriteMaterial({ map: nameTexture, transparent: true, depthTest: false });
  const nameSprite = new THREE.Sprite(spriteMat);
  nameSprite.position.set(0, 1.98, 0);
  nameSprite.scale.set(1.7, 0.42, 1);
  group.add(nameSprite);

  addContactShadow(group, 0.46, 0.46, textures.contactShadow, 0.45);
  applyStylizedShaderToObject(bodyRoot, { rimStrength: 0.46, celBoost: 0.54 });
  addCartoonOutline(bodyRoot, 0.021, 0x160f0d);

  return {
    group,
    bodyRoot,
    headGroup,
    hatGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    stickGroup,
    nameSprite,
    nameTexture,
  };
}

// ==================== 8. GNOME MINI-COPTER, MAVIC DRONE & DISMEMBERMENT ====================

export interface MiniCopterRig {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  mainRotor: THREE.Group;
  tailRotor: THREE.Group;
  pilotDecoy: THREE.Group;
  hookAnchor: THREE.Object3D;
  searchLightCone: THREE.Mesh;
}

export function createMiniCopterModel(textures: TextureLibrary): MiniCopterRig {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xc2382b, roughness: 0.48, metalness: 0.14 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x354e6b, roughness: 0.65 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xaab4be, metalness: 0.85, roughness: 0.25 });
  const darkIronMat = new THREE.MeshStandardMaterial({ color: 0x22262b, metalness: 0.72, roughness: 0.38 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a43f, metalness: 0.84, roughness: 0.26 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x5c3720, roughness: 0.78 });
  const canopyMat = new THREE.MeshPhysicalMaterial({
    color: 0xbde8ff,
    transparent: true,
    opacity: 0.34,
    roughness: 0.06,
    metalness: 0.05,
    clearcoat: 1.0,
    ior: 1.48,
    depthWrite: false,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xfff0b5,
    emissive: 0xffb838,
    emissiveIntensity: 1.65,
    roughness: 0.2,
  });

  // 1. Twin tubular landing skids + cross struts (planted flush at y = 0)
  [-0.58, 0.58].forEach((sx) => {
    const skidCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx, 0.06, 0.82),
      new THREE.Vector3(sx, 0.06, -0.78),
      new THREE.Vector3(sx, 0.22, -1.04),
    ]);
    const skid = new THREE.Mesh(new THREE.TubeGeometry(skidCurve, 14, 0.045, 8, false), darkIronMat);
    skid.castShadow = true;
    bodyGroup.add(skid);

    [-0.36, 0.42].forEach((sz) => {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.44, 8), steelMat);
      strut.position.set(sx * 0.82, 0.25, sz);
      strut.rotation.z = sx > 0 ? 0.38 : -0.38;
      strut.castShadow = true;
      bodyGroup.add(strut);
    });
  });

  // 2. Sculpted cockpit floor tub + engine cowling + red nose cone
  const floorPan = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 1.35), trimMat);
  floorPan.position.set(0, 0.46, -0.02);
  floorPan.castShadow = true;
  bodyGroup.add(floorPan);

  const nosePts = [
    new THREE.Vector2(0.0, -0.45),
    new THREE.Vector2(0.46, -0.45),
    new THREE.Vector2(0.5, -0.15),
    new THREE.Vector2(0.44, 0.18),
    new THREE.Vector2(0.24, 0.42),
    new THREE.Vector2(0.0, 0.48),
  ];
  const noseCone = new THREE.Mesh(new THREE.LatheGeometry(nosePts, 16), hullMat);
  noseCone.rotation.x = -Math.PI / 2;
  noseCone.scale.set(1.04, 1.0, 0.78);
  noseCone.position.set(0, 0.62, -0.62);
  noseCone.castShadow = true;
  bodyGroup.add(noseCone);

  // Rear engine block + brass exhaust stacks
  const engineBlock = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.72, 12), darkIronMat);
  engineBlock.rotation.x = Math.PI / 2;
  engineBlock.position.set(0, 0.92, 0.45);
  engineBlock.castShadow = true;
  bodyGroup.add(engineBlock);

  const topCowl = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), hullMat);
  topCowl.scale.set(1.0, 0.85, 1.35);
  topCowl.position.set(0, 1.08, 0.34);
  topCowl.castShadow = true;
  bodyGroup.add(topCowl);

  [-0.36, 0.36].forEach((ex) => {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.36, 8), brassMat);
    pipe.rotation.x = 0.55;
    pipe.rotation.z = ex > 0 ? -0.25 : 0.25;
    pipe.position.set(ex, 1.04, 0.68);
    bodyGroup.add(pipe);
  });

  // 3. Tubular roll-cage + bubble glass windscreen + leather seat & joystick
  const cageCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.42, 0.52, -0.45),
    new THREE.Vector3(-0.36, 1.32, -0.15),
    new THREE.Vector3(0, 1.44, 0.18),
    new THREE.Vector3(0.36, 1.32, -0.15),
    new THREE.Vector3(0.42, 0.52, -0.45),
  ]);
  const rollCage = new THREE.Mesh(new THREE.TubeGeometry(cageCurve, 18, 0.036, 8, false), steelMat);
  bodyGroup.add(rollCage);

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.49, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
    canopyMat
  );
  canopy.rotation.x = -0.68;
  canopy.position.set(0, 0.82, -0.38);
  canopy.userData.skipOutline = true;
  canopy.userData.skipStylize = true;
  bodyGroup.add(canopy);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.42), seatMat);
  seat.position.set(0, 0.78, 0.08);
  const joystick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.34, 8), darkIronMat);
  joystick.position.set(0, 0.66, -0.32);
  joystick.rotation.x = 0.2;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), hullMat);
  knob.position.set(0, 0.82, -0.35);
  bodyGroup.add(seat, joystick, knob);

  // 4. Tail boom + twin tail fins + tail rotor
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.17, 1.45, 10), hullMat);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.96, 1.35);
  boom.castShadow = true;
  bodyGroup.add(boom);

  const vFin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.54, 0.34), trimMat);
  vFin.position.set(0, 1.15, 1.98);
  vFin.rotation.x = -0.35;
  const hFin = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.24), trimMat);
  hFin.position.set(0, 0.96, 1.72);
  bodyGroup.add(vFin, hFin);

  // 5. Front Searchlight & Hook Anchor
  const lampRim = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 12), brassMat);
  lampRim.rotation.x = Math.PI / 2;
  lampRim.position.set(0, 0.56, -1.04);
  const lampLens = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), glowMat);
  lampLens.position.set(0, 0.56, -1.1);
  bodyGroup.add(lampRim, lampLens);

  const searchLightCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.85, 3.4, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffe49e,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  searchLightCone.rotation.x = -Math.PI / 2 + 0.18;
  searchLightCone.position.set(0, 0.26, -2.7);
  searchLightCone.visible = false;
  searchLightCone.userData.skipOutline = true;
  searchLightCone.userData.skipStylize = true;
  bodyGroup.add(searchLightCone);

  const hookAnchor = new THREE.Object3D();
  hookAnchor.position.set(0, 0.02, -0.05);
  bodyGroup.add(hookAnchor);

  const hookRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.024, 6, 12), brassMat);
  hookRing.position.set(0, 0.26, -0.05);
  bodyGroup.add(hookRing);

  // 6. Main & Tail Rotors
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 1.52, 0.14);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.28, 10), steelMat);
  mast.position.y = -0.1;
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.1, 12), brassMat);
  mainRotor.add(mast, hubCap);

  [-1, 1].forEach((dir) => {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.024, 1.52), darkIronMat);
    blade.position.set(0, 0.02, dir * 0.8);
    blade.rotation.z = dir * 0.07;
    blade.castShadow = true;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.026, 0.22), hullMat);
    tip.position.set(0, 0.02, dir * 1.46);
    tip.userData.skipOutline = true;
    mainRotor.add(blade, tip);
  });
  bodyGroup.add(mainRotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.11, 1.06, 2.02);
  const tHub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 8), brassMat);
  tHub.rotation.z = Math.PI / 2;
  tailRotor.add(tHub);
  [-1, 1].forEach((dir) => {
    const tBlade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.07), darkIronMat);
    tBlade.position.set(0.02, dir * 0.18, 0);
    tBlade.userData.skipOutline = true;
    tailRotor.add(tBlade);
  });
  bodyGroup.add(tailRotor);

  // 7. Pilot Decoy Gnome (visible when piloted remotely or in 3rd-person cockpit view!)
  const pilotDecoy = new THREE.Group();
  pilotDecoy.position.set(0, 0.65, -0.02);
  pilotDecoy.visible = false;
  const pilotJacket = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.38, 12), trimMat);
  pilotJacket.position.y = 0.18;
  const pilotHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xe3b493, roughness: 0.72 })
  );
  pilotHead.position.y = 0.44;
  const pilotHat = createCurvedGnomeHat({
    hatMat: hullMat,
    trimMat: hullMat,
    brassMat,
    accentMat: hullMat,
    scale: 0.56,
    slouchX: -0.08,
    slouchZ: 0.2,
    isRoyal: false,
  });
  pilotHat.position.set(0, 0.48, 0);
  pilotDecoy.add(pilotJacket, pilotHead, pilotHat);
  bodyGroup.add(pilotDecoy);

  addContactShadow(group, 1.15, 1.35, textures.contactShadow, 0.45);
  applyStylizedShaderToObject(bodyGroup, { rimStrength: 0.42, celBoost: 0.5 });
  addCartoonOutline(bodyGroup, 0.018, 0x160f0d);

  return {
    group,
    bodyGroup,
    mainRotor,
    tailRotor,
    pilotDecoy,
    hookAnchor,
    searchLightCone,
  };
}

export interface MavicDroneRig {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  rotors: THREE.Group[];
  gimbal: THREE.Group;
  clawAnchor: THREE.Object3D;
}

export function createMavicDroneModel(): MavicDroneRig {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const shellMat = new THREE.MeshStandardMaterial({ color: 0x3b424c, roughness: 0.42, metalness: 0.35 });
  const darkCarbonMat = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.5, metalness: 0.55 });
  const accentOrangeMat = new THREE.MeshStandardMaterial({ color: 0xe8732a, roughness: 0.38 });
  const lensGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x1e6091,
    roughness: 0.05,
    metalness: 0.15,
    clearcoat: 1.0,
    reflectivity: 0.95,
  });
  const greenLedMat = new THREE.MeshStandardMaterial({
    color: 0x6bffa6,
    emissive: 0x26e678,
    emissiveIntensity: 1.8,
  });
  const redLedMat = new THREE.MeshStandardMaterial({
    color: 0xff6e63,
    emissive: 0xe62c20,
    emissiveIntensity: 1.6,
  });

  // Central aerodynamic Mavic body + top snap-in battery pack
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.52), shellMat);
  hull.castShadow = true;
  const battery = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.34), darkCarbonMat);
  battery.position.set(0, 0.09, 0.04);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.025, 0.09), accentOrangeMat);
  stripe.position.set(0, 0.135, -0.02);
  bodyGroup.add(hull, battery, stripe);

  // Front 2-axis camera gimbal (looks along -Z forward!)
  const gimbal = new THREE.Group();
  gimbal.position.set(0, -0.04, -0.28);
  const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.12), darkCarbonMat);
  const lensBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 12), darkCarbonMat);
  lensBarrel.rotation.x = Math.PI / 2;
  lensBarrel.position.z = -0.06;
  const lensGlass = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), lensGlassMat);
  lensGlass.position.z = -0.082;
  lensGlass.userData.skipOutline = true;
  gimbal.add(camBody, lensBarrel, lensGlass);
  bodyGroup.add(gimbal);

  // 4 Foldable Arms + Motor Pods + Prop Guards + Spinning Rotors + Nav LEDs
  const rotors: THREE.Group[] = [];
  const armOffsets: Array<[number, number, boolean]> = [
    [-0.34, -0.28, true],
    [0.34, -0.28, true],
    [-0.32, 0.28, false],
    [0.32, 0.28, false],
  ];

  armOffsets.forEach(([ax, az, isFront]) => {
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ax * 0.28, 0, az * 0.32),
      new THREE.Vector3(ax, 0.02, az),
    ]);
    const arm = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 6, 0.032, 7, false), darkCarbonMat);
    arm.castShadow = true;
    bodyGroup.add(arm);

    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.08, 10), shellMat);
    pod.position.set(ax, 0.03, az);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.014, 6, 18), darkCarbonMat);
    guard.rotation.x = Math.PI / 2;
    guard.position.set(ax, 0.065, az);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 6, 6),
      isFront ? greenLedMat : redLedMat
    );
    led.position.set(ax, -0.015, az);
    bodyGroup.add(pod, guard, led);

    const rotor = new THREE.Group();
    rotor.position.set(ax, 0.075, az);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.008, 0.036), accentOrangeMat);
    const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.008, 0.32), accentOrangeMat);
    blade.userData.skipOutline = true;
    blade2.userData.skipOutline = true;
    rotor.add(blade, blade2);
    bodyGroup.add(rotor);
    rotors.push(rotor);
  });

  // Bottom magnetic micro-claw anchor
  const clawAnchor = new THREE.Object3D();
  clawAnchor.position.set(0, -0.14, 0);
  bodyGroup.add(clawAnchor);

  const clawPod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.07, 8), accentOrangeMat);
  clawPod.position.set(0, -0.1, 0);
  bodyGroup.add(clawPod);

  applyStylizedShaderToObject(bodyGroup, { rimStrength: 0.45, celBoost: 0.5 });
  addCartoonOutline(bodyGroup, 0.012, 0x141619);

  return { group, bodyGroup, rotors, gimbal, clawAnchor };
}

export type SeveredPartKind = 'arm' | 'leg' | 'hat' | 'head' | 'bugLeg';

export function createSeveredPartModel(
  kind: SeveredPartKind,
  colorId: GnomeColorId = 'red'
): THREE.Group {
  const palette = GNOME_COLOR_PALETTE[colorId] ?? GNOME_COLOR_PALETTE.red;
  const g = new THREE.Group();

  const stumpMat = new THREE.MeshStandardMaterial({ color: 0xa61c1c, roughness: 0.55 });
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.6 });
  const tunicMat = new THREE.MeshStandardMaterial({ color: palette.tunic, roughness: 0.85 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xeee9df, roughness: 0.84 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe3b493, roughness: 0.72 });
  const hatMat = new THREE.MeshStandardMaterial({ color: palette.hat, roughness: 0.78 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x3b2517, roughness: 0.68 });
  const soleMat = new THREE.MeshStandardMaterial({ color: 0x1d130d, roughness: 0.9 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xbac2cc, metalness: 0.78, roughness: 0.28 });

  if (kind === 'arm') {
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.082, 0.2, 10), tunicMat);
    sleeve.position.y = 0.06;
    const whiteArm = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.072, 0.16, 10), whiteMat);
    whiteArm.position.y = -0.12;
    const hand = createSculptedHand(skinMat, 1, 0.1, false);
    hand.position.y = -0.2;
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.03, 10), stumpMat);
    stump.position.y = 0.16;
    const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.07, 8), boneMat);
    bone.position.y = 0.19;
    g.add(sleeve, whiteArm, hand, stump, bone);
  } else if (kind === 'leg') {
    const pant = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.085, 0.2, 10), tunicMat);
    pant.position.y = 0.12;
    const boot = createPointedGnomeBoot({
      leatherMat: bootMat,
      soleMat,
      cuffMat: bootMat,
      brassMat,
      scale: 0.64,
    });
    boot.position.y = -0.14;
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 10), stumpMat);
    stump.position.y = 0.22;
    const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.07, 8), boneMat);
    bone.position.y = 0.25;
    g.add(pant, boot, stump, bone);
  } else if (kind === 'hat') {
    const hat = createCurvedGnomeHat({
      hatMat,
      trimMat: hatMat,
      brassMat,
      accentMat: hatMat,
      scale: 0.78,
      slouchX: -0.1,
      slouchZ: -0.22,
      isRoyal: false,
    });
    g.add(hat);
  } else if (kind === 'head') {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), skinMat);
    const nose = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd67c6a, roughness: 0.52 })
    );
    nose.position.set(0, -0.02, 0.2);
    const beard = createLayeredGnomeBeard({
      beardMat: new THREE.MeshStandardMaterial({ color: 0xd9cdb8, roughness: 0.9 }),
      scale: 0.64,
      lengthScale: 0.85,
      braided: false,
    });
    beard.position.set(0, -0.06, 0.16);
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 10), stumpMat);
    stump.position.y = -0.19;
    g.add(head, nose, beard, stump);
  } else {
    // Chitinous insect leg
    const chitinMat = new THREE.MeshStandardMaterial({ color: 0x3b2316, roughness: 0.42, metalness: 0.18 });
    const legCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.18, 0.14, 0),
      new THREE.Vector3(0.32, -0.18, 0),
    ]);
    const leg = new THREE.Mesh(new THREE.TubeGeometry(legCurve, 8, 0.024, 6, false), chitinMat);
    g.add(leg);
  }

  applyStylizedShaderToObject(g, { rimStrength: 0.4, celBoost: 0.5 });
  addCartoonOutline(g, 0.015, 0x160f0d);
  return g;
}

// ==================== 2-SEATER GNOME CAR ====================
export interface GnomeCarRig {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  steeringWheel: THREE.Group;
  wheels: THREE.Group[];
  frontPivots: THREE.Group[];
  driverSlot: THREE.Object3D;
  passengerSlot: THREE.Object3D;
  driverDummy: THREE.Group;
  passengerDummy: THREE.Group;
}

export function createGnomeCarModel(textures: TextureLibrary): GnomeCarRig {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const chassisMat = new THREE.MeshStandardMaterial({ color: 0xd93829, roughness: 0.36, metalness: 0.18 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf7cf46, roughness: 0.42 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x262a30, roughness: 0.45, metalness: 0.72 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8dfe6, roughness: 0.22, metalness: 0.9 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.88 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x6b4128, roughness: 0.75 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xc2ecff,
    transparent: true,
    opacity: 0.38,
    roughness: 0.08,
    clearcoat: 1.0,
    depthWrite: false,
  });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xfff5c4,
    emissive: 0xffd269,
    emissiveIntensity: 1.7,
  });
  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0xff4b3e,
    emissive: 0xe61c10,
    emissiveIntensity: 1.35,
  });

  // Main chassis tub & hood (Forward is -Z!)
  const floorPan = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.24, 3.65), darkMetalMat);
  floorPan.position.set(0, 0.36, 0);
  floorPan.castShadow = true;
  bodyGroup.add(floorPan);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.56, 1.35), chassisMat);
  hood.position.set(0, 0.72, -1.15);
  hood.castShadow = true;
  const racingStripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 1.36), stripeMat);
  racingStripe.position.set(0, 1.01, -1.15);
  bodyGroup.add(hood, racingStripe);

  // Side doors / sills + rear bench fairing
  [-0.96, 0.96].forEach((sx) => {
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.54, 1.68), chassisMat);
    sideWall.position.set(sx, 0.71, 0.28);
    sideWall.castShadow = true;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.08, 1.66), stripeMat);
    trim.position.set(sx, 0.94, 0.28);
    bodyGroup.add(sideWall, trim);
  });

  const rearDeck = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.64, 0.85), chassisMat);
  rearDeck.position.set(0, 0.76, 1.44);
  rearDeck.castShadow = true;
  const rollBar = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.065, 8, 20, Math.PI), chromeMat);
  rollBar.position.set(0, 0.98, 0.98);
  bodyGroup.add(rearDeck, rollBar);

  // Chrome bumpers, radiator grille, headlights & taillights
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.16, 0.22), chromeMat);
  frontBumper.position.set(0, 0.44, -1.86);
  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.16, 0.22), chromeMat);
  rearBumper.position.set(0, 0.44, 1.9);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.38, 0.1), chromeMat);
  grille.position.set(0, 0.72, -1.83);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.46, 10), chromeMat);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(-0.62, 0.34, 1.94);
  bodyGroup.add(frontBumper, rearBumper, grille, exhaust);

  [-0.72, 0.72].forEach((lx) => {
    const hlRim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.12, 12), chromeMat);
    hlRim.rotation.x = Math.PI / 2;
    hlRim.position.set(lx, 0.76, -1.82);
    const hlBulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), headlightMat);
    hlBulb.position.set(lx, 0.76, -1.86);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.08), taillightMat);
    tl.position.set(lx, 0.78, 1.88);
    bodyGroup.add(hlRim, hlBulb, tl);
  });

  // Windshield frame & glass
  const wsGlass = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.56, 0.06), glassMat);
  wsGlass.position.set(0, 1.24, -0.45);
  wsGlass.rotation.x = 0.26;
  wsGlass.userData.skipOutline = true;
  const wsFrameTop = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.07, 0.1), chromeMat);
  wsFrameTop.position.set(0, 1.51, -0.38);
  bodyGroup.add(wsGlass, wsFrameTop);

  // Two Side-by-Side Gnome Seats (Driver Left -X, Passenger Right +X)
  [-0.46, 0.46].forEach((sx) => {
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.18, 0.64), leatherMat);
    cushion.position.set(sx, 0.55, 0.22);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.62, 0.16), leatherMat);
    backrest.position.set(sx, 0.88, 0.5);
    backrest.rotation.x = -0.14;
    bodyGroup.add(cushion, backrest);
  });

  // Steering Column + Wheel (left driver seat)
  const steeringCol = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.56, 8), darkMetalMat);
  steeringCol.position.set(-0.46, 0.86, -0.24);
  steeringCol.rotation.x = -0.65;
  bodyGroup.add(steeringCol);

  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(-0.46, 1.04, -0.06);
  steeringWheel.rotation.x = -0.65;
  const swRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.032, 8, 18), darkMetalMat);
  const swSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 0.03), chromeMat);
  steeringWheel.add(swRing, swSpoke);
  bodyGroup.add(steeringWheel);

  // Driver & Passenger anchors + dummy gnome models (shown for remote occupants or camera)
  const driverSlot = new THREE.Object3D();
  driverSlot.position.set(-0.46, 0.64, 0.22);
  const passengerSlot = new THREE.Object3D();
  passengerSlot.position.set(0.46, 0.64, 0.22);
  bodyGroup.add(driverSlot, passengerSlot);

  const makeSeatDummy = (hatCol: number, coatCol: number) => {
    const d = new THREE.Group();
    d.visible = false;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.4, 10),
      new THREE.MeshStandardMaterial({ color: coatCol, roughness: 0.82 })
    );
    body.position.y = 0.22;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xe3b493, roughness: 0.72 })
    );
    head.position.y = 0.5;
    const hat = createCurvedGnomeHat({
      hatMat: new THREE.MeshStandardMaterial({ color: hatCol, roughness: 0.75 }),
      trimMat: stripeMat,
      brassMat: chromeMat,
      accentMat: stripeMat,
      scale: 0.55,
      slouchX: -0.08,
      slouchZ: 0.16,
      isRoyal: false,
    });
    hat.position.set(0, 0.54, 0);
    d.add(body, head, hat);
    return d;
  };
  const driverDummy = makeSeatDummy(0xc93528, 0x2c4e8a);
  const passengerDummy = makeSeatDummy(0x2e8048, 0x456982);
  driverSlot.add(driverDummy);
  passengerSlot.add(passengerDummy);

  // 4 Stylized Wheels + Front Steering Pivots
  const wheels: THREE.Group[] = [];
  const frontPivots: THREE.Group[] = [];
  const wheelCoords: Array<[number, number, boolean]> = [
    [-1.08, -1.16, true],
    [1.08, -1.16, true],
    [-1.08, 1.18, false],
    [1.08, 1.18, false],
  ];
  wheelCoords.forEach(([wx, wz, isFront]) => {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.36, wz);
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16), rubberMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 12), chromeMat);
    rim.rotation.z = Math.PI / 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.06), chassisMat);
    wheel.add(tire, rim, spoke);
    pivot.add(wheel);
    group.add(pivot);
    wheels.push(wheel);
    if (isFront) frontPivots.push(pivot);
  });

  addContactShadow(group, 1.55, 2.25, textures.contactShadow, 0.52);
  applyStylizedShaderToObject(bodyGroup, { rimStrength: 0.45, celBoost: 0.54 });
  addCartoonOutline(bodyGroup, 0.02, 0x160f0d);

  return {
    group,
    bodyGroup,
    steeringWheel,
    wheels,
    frontPivots,
    driverSlot,
    passengerSlot,
    driverDummy,
    passengerDummy,
  };
}

// ==================== GIANT BOSS GNOME ("БОЛЬШОЙ ГНОМ") ====================
export interface GiantBossGnomeRig {
  group: THREE.Group;
  bodyRoot: THREE.Group;
  torsoGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  alertBadge: THREE.Mesh;
}

export function createGiantBossGnomeModel(textures: TextureLibrary): GiantBossGnomeRig {
  const group = new THREE.Group();
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);

  // Towering ~5.2x scale (approx ~10 units tall — larger than regular gnomes, terrifyingly huge!)
  const s = 5.2;
  const armorMat = new THREE.MeshStandardMaterial({ color: 0x454d59, roughness: 0.38, metalness: 0.65 });
  const coatMat = new THREE.MeshStandardMaterial({ color: 0x7a1c18, roughness: 0.78 });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0xb82218, roughness: 0.72 });
  const beardMat = new THREE.MeshStandardMaterial({ color: 0xe6dfd0, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xdba382, roughness: 0.72 });
  const beltMat = new THREE.MeshStandardMaterial({ color: 0x24160e, roughness: 0.65 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xe6b547, roughness: 0.26, metalness: 0.85 });
  const eyeGlowMat = new THREE.MeshStandardMaterial({
    color: 0xff4f3b,
    emissive: 0xff2211,
    emissiveIntensity: 2.2,
  });

  const torsoGroup = new THREE.Group();
  torsoGroup.position.y = 0.92 * s;
  bodyRoot.add(torsoGroup);

  const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * s, 0.48 * s, 0.78 * s, 14), coatMat);
  belly.position.y = 0.36 * s;
  belly.castShadow = true;
  const chestPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.45 * s, 0.43 * s, 0.44 * s, 14), armorMat);
  chestPlate.position.y = 0.56 * s;
  chestPlate.castShadow = true;
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.49 * s, 0.49 * s, 0.14 * s, 14), beltMat);
  belt.position.y = 0.14 * s;
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.24 * s, 0.18 * s, 0.08 * s), goldMat);
  buckle.position.set(0, 0.14 * s, 0.48 * s);
  torsoGroup.add(belly, chestPlate, belt, buckle);

  // Spiked Iron Pauldrons
  [-1, 1].forEach((side) => {
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.24 * s, 12, 10), armorMat);
    pauldron.scale.set(1.15, 0.8, 1.05);
    pauldron.position.set(side * 0.52 * s, 0.68 * s, 0);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08 * s, 0.24 * s, 8), goldMat);
    spike.position.set(side * 0.6 * s, 0.86 * s, 0);
    spike.rotation.z = -side * 0.45;
    torsoGroup.add(pauldron, spike);
  });

  // Head + Glowing Crimson Angry Eyes + Massive Braided Beard + Spiked Helmet Hat
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.82 * s, 0.04 * s);
  torsoGroup.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32 * s, 16, 14), skinMat);
  head.position.y = 0.24 * s;
  head.castShadow = true;
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.11 * s, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xc95e4c, roughness: 0.52 })
  );
  nose.position.set(0, 0.2 * s, 0.32 * s);
  headGroup.add(head, nose);

  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055 * s, 10, 10), eyeGlowMat);
    eye.position.set(side * 0.11 * s, 0.28 * s, 0.27 * s);
    eye.userData.skipOutline = true;
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.045 * s, 0.06 * s), beardMat);
    brow.position.set(side * 0.11 * s, 0.35 * s, 0.28 * s);
    brow.rotation.z = side * 0.35;
    headGroup.add(eye, brow);
  });

  const beard = createLayeredGnomeBeard({
    beardMat,
    scale: 1.35 * s,
    lengthScale: 1.4,
    braided: true,
    brassMat: goldMat,
  });
  beard.position.set(0, 0.12 * s, 0.25 * s);
  headGroup.add(beard);

  const hat = createCurvedGnomeHat({
    hatMat,
    trimMat: armorMat,
    brassMat: goldMat,
    accentMat: goldMat,
    scale: 1.15 * s,
    slouchX: 0.06,
    slouchZ: -0.18,
    isRoyal: true,
  });
  hat.position.set(0, 0.36 * s, -0.02 * s);
  headGroup.add(hat);

  // Arms + Giant Forged Warhammer on Right Arm
  const makeArm = (side: -1 | 1, withHammer: boolean) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.52 * s, 0.66 * s, 0);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.13 * s, 0.52 * s, 10), coatMat);
    sleeve.position.y = -0.24 * s;
    sleeve.castShadow = true;
    const hand = createSculptedHand(skinMat, side, 0.22 * s, true);
    hand.position.y = -0.52 * s;
    arm.add(sleeve, hand);

    if (withHammer) {
      const hammer = new THREE.Group();
      hammer.position.set(0, -0.54 * s, 0.14 * s);
      hammer.rotation.x = Math.PI / 2;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * s, 0.065 * s, 1.55 * s, 10), beltMat);
      shaft.position.y = 0.45 * s;
      const headBlock = new THREE.Mesh(new THREE.BoxGeometry(0.38 * s, 0.36 * s, 0.72 * s), armorMat);
      headBlock.position.y = 1.12 * s;
      const goldBand = new THREE.Mesh(new THREE.BoxGeometry(0.41 * s, 0.39 * s, 0.18 * s), goldMat);
      goldBand.position.y = 1.12 * s;
      hammer.add(shaft, headBlock, goldBand);
      arm.add(hammer);
    }
    torsoGroup.add(arm);
    return arm;
  };
  const leftArm = makeArm(-1, false);
  const rightArm = makeArm(1, true);

  // Heavy Boots & Legs
  const makeLeg = (side: number) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.24 * s, 0.92 * s, 0);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.16 * s, 0.62 * s, 12), armorMat);
    thigh.position.y = -0.32 * s;
    thigh.castShadow = true;
    const boot = createPointedGnomeBoot({
      leatherMat: beltMat,
      soleMat: armorMat,
      cuffMat: armorMat,
      brassMat: goldMat,
      scale: 0.95 * s,
    });
    boot.position.y = -0.92 * s;
    leg.add(thigh, boot);
    bodyRoot.add(leg);
    return leg;
  };
  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  const alertBadge = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.65, 0),
    new THREE.MeshStandardMaterial({ color: 0xff3b28, emissive: 0xff1e0a, emissiveIntensity: 2.0 })
  );
  alertBadge.position.set(0, 2.55 * s, 0);
  alertBadge.visible = true;
  group.add(alertBadge);

  addContactShadow(group, 2.6, 2.6, textures.contactShadow, 0.65);
  applyStylizedShaderToObject(bodyRoot, { rimStrength: 0.55, celBoost: 0.65 });
  addCartoonOutline(bodyRoot, 0.04, 0x120909);

  return { group, bodyRoot, torsoGroup, headGroup, leftArm, rightArm, leftLeg, rightLeg, alertBadge };
}

// ==================== YARD GUARD DOG ====================
export interface DogRig {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  tail: THREE.Group;
  legs: THREE.Group[];
}

export function createDogModel(textures: TextureLibrary): DogRig {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const furMat = new THREE.MeshStandardMaterial({ color: 0xb8763e, roughness: 0.85 });
  const bellyFurMat = new THREE.MeshStandardMaterial({ color: 0xe6c79c, roughness: 0.88 });
  const earMat = new THREE.MeshStandardMaterial({ color: 0x5c361c, roughness: 0.86 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x1a1717, roughness: 0.3 });
  const collarMat = new THREE.MeshStandardMaterial({ color: 0xc92c22, roughness: 0.55 });
  const tagMat = new THREE.MeshStandardMaterial({ color: 0xf2c64b, roughness: 0.25, metalness: 0.85 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x181512, roughness: 0.2 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xfcf8f0, roughness: 0.25 });

  // Torso (scaled nicely for gnome world: ~1.55m tall dog!)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.84, 1.72), furMat);
  torso.position.set(0, 1.05, 0);
  torso.castShadow = true;
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), bellyFurMat);
  chest.scale.set(0.9, 0.95, 1.05);
  chest.position.set(0, 1.02, 0.55);
  bodyGroup.add(torso, chest);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 8, 16), collarMat);
  collar.rotation.x = Math.PI / 2 - 0.35;
  collar.position.set(0, 1.38, 0.72);
  const tag = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 10), tagMat);
  tag.rotation.x = Math.PI / 2;
  tag.position.set(0, 1.18, 1.05);
  bodyGroup.add(collar, tag);

  // Head + Snout + Floppy Ears
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.56, 0.84);
  bodyGroup.add(headGroup);

  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.68, 0.74), furMat);
  skull.castShadow = true;
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.52), bellyFurMat);
  snout.position.set(0, -0.1, 0.48);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), noseMat);
  nose.position.set(0, 0.02, 0.74);
  headGroup.add(skull, snout, nose);

  [-1, 1].forEach((side) => {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.46, 0.3), earMat);
    ear.position.set(side * 0.42, -0.02, 0.02);
    ear.rotation.z = side * 0.25;
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 8), whiteMat);
    sclera.position.set(side * 0.2, 0.12, 0.36);
    sclera.userData.skipOutline = true;
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), eyeMat);
    pupil.position.set(side * 0.2, 0.12, 0.43);
    pupil.userData.skipOutline = true;
    headGroup.add(ear, sclera, pupil);
  });

  // Wagging Tail
  const tail = new THREE.Group();
  tail.position.set(0, 1.32, -0.82);
  const tailMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.72, 8), furMat);
  tailMesh.position.set(0, 0.28, -0.18);
  tailMesh.rotation.x = -0.65;
  tail.add(tailMesh);
  bodyGroup.add(tail);

  // 4 Articulated Legs
  const legs: THREE.Group[] = [];
  const legPos: Array<[number, number]> = [
    [-0.3, 0.58],
    [0.3, 0.58],
    [-0.3, -0.58],
    [0.3, -0.58],
  ];
  legPos.forEach(([lx, lz]) => {
    const leg = new THREE.Group();
    leg.position.set(lx, 0.74, lz);
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.72, 10), furMat);
    limb.position.y = -0.35;
    limb.castShadow = true;
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), bellyFurMat);
    paw.scale.set(1, 0.65, 1.25);
    paw.position.set(0, -0.68, 0.05);
    leg.add(limb, paw);
    bodyGroup.add(leg);
    legs.push(leg);
  });

  addContactShadow(group, 0.9, 1.25, textures.contactShadow, 0.45);
  applyStylizedShaderToObject(bodyGroup, { rimStrength: 0.45, celBoost: 0.55 });
  addCartoonOutline(bodyGroup, 0.022, 0x1a110b);

  return { group, bodyGroup, headGroup, tail, legs };
}

// ==================== HOUSE CAT ====================
export interface CatRig {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  tail: THREE.Group;
  legs: THREE.Group[];
}

export function createCatModel(textures: TextureLibrary): CatRig {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const orangeMat = new THREE.MeshStandardMaterial({ color: 0xe68432, roughness: 0.78 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xa64d17, roughness: 0.82 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xf7ebd2, roughness: 0.85 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0xeb8d9c, roughness: 0.5 });
  const eyeGlowMat = new THREE.MeshStandardMaterial({
    color: 0x7eff5c,
    emissive: 0x3ec423,
    emissiveIntensity: 1.1,
  });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x101410, roughness: 0.2 });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 1.15, 12), orangeMat);
  torso.rotation.x = Math.PI / 2;
  torso.position.set(0, 0.68, 0);
  torso.castShadow = true;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), creamMat);
  belly.scale.set(0.85, 0.85, 1.15);
  belly.position.set(0, 0.65, 0.42);
  bodyGroup.add(torso, belly);

  [-0.22, 0.14].forEach((sz) => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.045, 6, 14), stripeMat);
    band.position.set(0, 0.68, sz);
    bodyGroup.add(band);
  });

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.02, 0.66);
  bodyGroup.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), orangeMat);
  head.scale.set(1.08, 0.95, 0.98);
  head.castShadow = true;
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), creamMat);
  muzzle.scale.set(1.2, 0.8, 0.85);
  muzzle.position.set(0, -0.08, 0.26);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), noseMat);
  nose.position.set(0, -0.04, 0.38);
  headGroup.add(head, muzzle, nose);

  [-1, 1].forEach((side) => {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.28, 4), orangeMat);
    ear.position.set(side * 0.21, 0.31, -0.02);
    ear.rotation.z = -side * 0.22;
    ear.rotation.y = Math.PI / 4;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.068, 8, 8), eyeGlowMat);
    eye.position.set(side * 0.14, 0.05, 0.28);
    eye.userData.skipOutline = true;
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.085, 0.04), pupilMat);
    slit.position.set(side * 0.14, 0.05, 0.34);
    slit.userData.skipOutline = true;
    headGroup.add(ear, eye, slit);
  });

  // Curved Cat Tail
  const tail = new THREE.Group();
  tail.position.set(0, 0.78, -0.56);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.32, -0.24),
    new THREE.Vector3(0, 0.68, -0.14),
    new THREE.Vector3(0, 0.86, -0.32),
  ]);
  const tailMesh = createTaperedSplineMesh(tailCurve, 10, 8, (t) => 0.075 - t * 0.025, orangeMat);
  tail.add(tailMesh);
  bodyGroup.add(tail);

  const legs: THREE.Group[] = [];
  const legPos: Array<[number, number]> = [
    [-0.19, 0.38],
    [0.19, 0.38],
    [-0.19, -0.38],
    [0.19, -0.38],
  ];
  legPos.forEach(([lx, lz]) => {
    const leg = new THREE.Group();
    leg.position.set(lx, 0.48, lz);
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.48, 8), orangeMat);
    limb.position.y = -0.24;
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 8), creamMat);
    paw.scale.set(1, 0.65, 1.2);
    paw.position.set(0, -0.46, 0.03);
    leg.add(limb, paw);
    bodyGroup.add(leg);
    legs.push(leg);
  });

  addContactShadow(group, 0.65, 0.95, textures.contactShadow, 0.4);
  applyStylizedShaderToObject(bodyGroup, { rimStrength: 0.45, celBoost: 0.55 });
  addCartoonOutline(bodyGroup, 0.018, 0x1a100a);

  return { group, bodyGroup, headGroup, tail, legs };
}

// ==================== LIVING TREE WITH EYES HUB ("ДЕРЕВО С ГЛАЗАМИ") ====================
export interface TreeWithEyesRig {
  group: THREE.Group;
  leftEyePivot: THREE.Group;
  rightEyePivot: THREE.Group;
  leftLid: THREE.Mesh;
  rightLid: THREE.Mesh;
  playCrystal: THREE.Mesh;
}

export function createTreeWithEyesModel(textures: TextureLibrary): TreeWithEyesRig {
  const group = new THREE.Group();

  const barkMat = new THREE.MeshStandardMaterial({
    map: textures.treeBark,
    color: 0x8c6244,
    roughness: 0.9,
  });
  const woodFloorMat = new THREE.MeshStandardMaterial({
    map: textures.oakWood,
    roughness: 0.85,
  });
  const leafDarkMat = new THREE.MeshStandardMaterial({ color: 0x2f6b36, roughness: 0.82 });
  const leafLightMat = new THREE.MeshStandardMaterial({ color: 0x5ea649, roughness: 0.78 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a442, roughness: 0.3, metalness: 0.82 });
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x5effa8,
    emissive: 0x24e070,
    emissiveIntensity: 1.85,
    roughness: 0.18,
  });
  const scleraMat = new THREE.MeshPhysicalMaterial({ color: 0xfbf7ed, roughness: 0.12, clearcoat: 1.0 });
  const irisMat = new THREE.MeshStandardMaterial({ color: 0xf0a82e, emissive: 0xc26e10, emissiveIntensity: 0.45, roughness: 0.2 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x120d0a, roughness: 0.15 });

  // Outer hollow oak trunk walls (doorway opens to +Z at x in [-3..3], y in [0..7.5])
  const buildWall = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), barkMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  // Back wall (z = -6), Side walls (x = -7, +7), Front piers flanking archway (z = +5.5)
  buildWall(0, 12, -6.5, 16, 24, 2.2);
  buildWall(-7.2, 12, -0.5, 2.2, 24, 13.5);
  buildWall(7.2, 12, -0.5, 2.2, 24, 13.5);
  buildWall(-5.0, 12, 5.5, 4.4, 24, 2.2);
  buildWall(5.0, 12, 5.5, 4.4, 24, 2.2);
  buildWall(0, 16.5, 5.5, 6.2, 15, 2.2);
  buildWall(0, 23.5, -0.5, 16.5, 2.0, 14.2);

  // Cozy wooden treehouse floor & warm rug inside
  const floor = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.32, 11.8), woodFloorMat);
  floor.position.set(0, 0.16, -0.4);
  floor.receiveShadow = true;
  group.add(floor);

  const hubRug = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.4, 0.08, 24),
    new THREE.MeshStandardMaterial({ map: textures.rugPattern, roughness: 0.92 })
  );
  hubRug.position.set(0, 0.34, -0.8);
  hubRug.receiveShadow = true;
  group.add(hubRug);

  // Gnarled roots radiating around the trunk base
  [
    [-8.4, 4.5, 0.6],
    [8.4, 4.5, -0.6],
    [-8.6, -5.2, -0.5],
    [8.6, -5.2, 0.5],
  ].forEach(([rx, rz, rot]) => {
    const root = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.9, 5.8, 8), barkMat);
    root.position.set(rx, 1.4, rz);
    root.rotation.z = rx < 0 ? 0.85 : -0.85;
    root.rotation.y = rot;
    root.castShadow = true;
    group.add(root);
  });

  // Archway door frame & warm interior lantern
  const archTop = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.8, 2.6), brassMat);
  archTop.position.set(0, 9.0, 5.5);
  group.add(archTop);

  const hubLight = new THREE.PointLight(0xffcb78, 1.85, 28, 1.3);
  hubLight.position.set(0, 7.6, -0.6);
  group.add(hubLight);

  // Lush Giant Oak Foliage Canopy above trunk
  const canopyBlobs: Array<[number, number, number, number, THREE.Material]> = [
    [0, 29, -0.5, 11.5, leafDarkMat],
    [-8.5, 26, 1.2, 8.2, leafLightMat],
    [8.5, 26, 1.2, 8.2, leafLightMat],
    [0, 27, 7.2, 7.6, leafLightMat],
    [0, 35, -0.5, 8.4, leafLightMat],
    [-6.2, 27, -7.2, 7.8, leafDarkMat],
    [6.2, 27, -7.2, 7.8, leafDarkMat],
  ];
  canopyBlobs.forEach(([cx, cy, cz, r, mat]) => {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
    puff.position.set(cx, cy, cz);
    puff.castShadow = true;
    group.add(puff);
  });

  // TWO GIANT EXPRESSIVE EYES on the Tree Face (+Z side above archway!)
  const makeTreeEye = (x: number) => {
    const socket = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.38, 10, 22), barkMat);
    socket.position.set(x, 14.8, 6.55);
    group.add(socket);

    const eyePivot = new THREE.Group();
    eyePivot.position.set(x, 14.8, 6.45);
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(1.55, 16, 14), scleraMat);
    sclera.scale.set(1, 1.05, 0.72);
    sclera.userData.skipOutline = true;
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.76, 14, 12), irisMat);
    iris.scale.set(1, 1, 0.45);
    iris.position.set(0, 0, 0.92);
    iris.userData.skipOutline = true;
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 10), pupilMat);
    pupil.scale.set(1, 1, 0.45);
    pupil.position.set(0, 0, 1.15);
    pupil.userData.skipOutline = true;
    const glint = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    glint.position.set(0.28, 0.34, 1.24);
    glint.userData.skipOutline = true;
    eyePivot.add(sclera, iris, pupil, glint);
    group.add(eyePivot);

    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(1.66, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      barkMat
    );
    lid.position.set(x, 14.8, 6.48);
    lid.rotation.x = -0.85;
    group.add(lid);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.52, 0.72), barkMat);
    brow.position.set(x, 16.9, 6.8);
    brow.rotation.z = x < 0 ? 0.14 : -0.14;
    group.add(brow);

    return { eyePivot, lid };
  };
  const leftEye = makeTreeEye(-3.1);
  const rightEye = makeTreeEye(3.1);

  // Cozy "PLAY" Pedestal inside the Treehouse hollow (z = -2.2)
  const pedBase = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.1, 1.3, 12), barkMat);
  pedBase.position.set(0, 0.95, -2.2);
  pedBase.castShadow = true;
  const pedPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.14, 16), brassMat);
  pedPlate.position.set(0, 1.65, -2.2);
  const playCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.58, 0), crystalMat);
  playCrystal.position.set(0, 2.38, -2.2);
  const pedLight = new THREE.PointLight(0x5effa8, 1.4, 14, 1.5);
  pedLight.position.set(0, 2.8, -2.2);
  group.add(pedBase, pedPlate, playCrystal, pedLight);

  applyStylizedShaderToObject(group, { rimStrength: 0.36, celBoost: 0.5 });
  addCartoonOutline(group, 0.04, 0x17100b);

  return {
    group,
    leftEyePivot: leftEye.eyePivot,
    rightEyePivot: rightEye.eyePivot,
    leftLid: leftEye.lid,
    rightLid: rightEye.lid,
    playCrystal,
  };
}


