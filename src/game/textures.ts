import * as THREE from 'three';

export interface TextureLibrary {
  kitchenTile: THREE.CanvasTexture;
  kitchenTileNormal: THREE.CanvasTexture;
  kitchenTileRoughness: THREE.CanvasTexture;
  oakWood: THREE.CanvasTexture;
  oakWoodNormal: THREE.CanvasTexture;
  oakWoodRoughness: THREE.CanvasTexture;
  burrowStone: THREE.CanvasTexture;
  burrowStoneNormal: THREE.CanvasTexture;
  marbleCounter: THREE.CanvasTexture;
  rugPattern: THREE.CanvasTexture;
  tablecloth: THREE.CanvasTexture;
  curtainFabric: THREE.CanvasTexture;
  cerealBox: THREE.CanvasTexture;
  matchboxLabel: THREE.CanvasTexture;
  cheeseRind: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  grassLawn: THREE.CanvasTexture;
  cobblePath: THREE.CanvasTexture;
  cobblePathNormal: THREE.CanvasTexture;
  wallpaperStripes: THREE.CanvasTexture;
  bedQuilt: THREE.CanvasTexture;
  paintingLandscape: THREE.CanvasTexture;
  paintingStillLife: THREE.CanvasTexture;
  bathTile: THREE.CanvasTexture;
  treeBark: THREE.CanvasTexture;
  shedWood: THREE.CanvasTexture;
  dispose: () => void;
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  repeatX: number,
  repeatY: number,
  maxAnisotropy: number,
  isColor = true
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Converts a grayscale height canvas into a tangent-space normal map canvas.
 */
function buildNormalCanvas(heightCanvas: HTMLCanvasElement, strength = 2.6): HTMLCanvasElement {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const hCtx = heightCanvas.getContext('2d')!;
  const src = hCtx.getImageData(0, 0, w, h).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d')!;
  const outImg = outCtx.createImageData(w, h);
  const dst = outImg.data;

  const sample = (x: number, y: number) => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }
  outCtx.putImageData(outImg, 0, 0);
  return outCanvas;
}

export function createProceduralTextures(maxAnisotropy: number): TextureLibrary {
  const textures: THREE.CanvasTexture[] = [];

  // 1. Kitchen checkerboard linoleum tiles + Normal & Roughness maps
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 512;
  tileCanvas.height = 512;
  const tCtx = tileCanvas.getContext('2d')!;

  const tileHeightCanvas = document.createElement('canvas');
  tileHeightCanvas.width = 256;
  tileHeightCanvas.height = 256;
  const thCtx = tileHeightCanvas.getContext('2d')!;
  thCtx.fillStyle = '#303030';
  thCtx.fillRect(0, 0, 256, 256);

  const tileRoughCanvas = document.createElement('canvas');
  tileRoughCanvas.width = 256;
  tileRoughCanvas.height = 256;
  const trCtx = tileRoughCanvas.getContext('2d')!;
  trCtx.fillStyle = '#e0e0e0'; // Matte grout
  trCtx.fillRect(0, 0, 256, 256);

  const half = 256;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      const tx = x * half;
      const ty = y * half;
      const tileGrad = tCtx.createLinearGradient(tx, ty, tx + half, ty + half);
      if ((x + y) % 2 === 0) {
        tileGrad.addColorStop(0, '#f5ecda');
        tileGrad.addColorStop(1, '#dfd2b8');
      } else {
        tileGrad.addColorStop(0, '#5a8e7f');
        tileGrad.addColorStop(1, '#3d665a');
      }
      tCtx.fillStyle = tileGrad;
      tCtx.fillRect(tx, ty, half, half);

      tCtx.fillStyle = 'rgba(255,250,235,0.25)';
      tCtx.fillRect(tx + 8, ty + 8, half - 16, 12);
      tCtx.fillRect(tx + 8, ty + 8, 12, half - 16);
      tCtx.fillStyle = 'rgba(26,20,16,0.16)';
      tCtx.fillRect(tx + 8, ty + half - 18, half - 16, 10);
      tCtx.fillRect(tx + half - 18, ty + 8, 10, half - 16);

      for (let i = 0; i < 40; i++) {
        tCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(30,22,15,0.08)';
        tCtx.beginPath();
        tCtx.arc(tx + 18 + Math.random() * (half - 36), ty + 18 + Math.random() * (half - 36), 2 + Math.random() * 4, 0, Math.PI * 2);
        tCtx.fill();
      }

      // Height & glossy roughness on 256x256 maps
      const hx = x * 128;
      const hy = y * 128;
      thCtx.fillStyle = '#e8e8e8';
      thCtx.beginPath();
      thCtx.roundRect(hx + 5, hy + 5, 118, 118, 6);
      thCtx.fill();
      trCtx.fillStyle = '#4f4f4f'; // Satin-gloss glazed ceramic
      trCtx.beginPath();
      trCtx.roundRect(hx + 5, hy + 5, 118, 118, 6);
      trCtx.fill();
    }
  }
  tCtx.strokeStyle = 'rgba(36,26,20,0.56)';
  tCtx.lineWidth = 7;
  tCtx.strokeRect(3, 3, 506, 506);
  tCtx.beginPath();
  tCtx.moveTo(half, 0);
  tCtx.lineTo(half, 512);
  tCtx.moveTo(0, half);
  tCtx.lineTo(512, half);
  tCtx.stroke();

  const kitchenTile = finalizeTexture(tileCanvas, 11, 11, maxAnisotropy);
  const kitchenTileNormal = finalizeTexture(buildNormalCanvas(tileHeightCanvas, 3.0), 11, 11, maxAnisotropy, false);
  const kitchenTileRoughness = finalizeTexture(tileRoughCanvas, 11, 11, maxAnisotropy, false);
  textures.push(kitchenTile, kitchenTileNormal, kitchenTileRoughness);

  // 2. Stylized hand-painted oak hardwood floorboards + Normal & Roughness maps
  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = 512;
  woodCanvas.height = 512;
  const wCtx = woodCanvas.getContext('2d')!;
  wCtx.fillStyle = '#361e10';
  wCtx.fillRect(0, 0, 512, 512);

  const woodHeightCanvas = document.createElement('canvas');
  woodHeightCanvas.width = 256;
  woodHeightCanvas.height = 256;
  const whCtx = woodHeightCanvas.getContext('2d')!;
  whCtx.fillStyle = '#282828';
  whCtx.fillRect(0, 0, 256, 256);

  const woodRoughCanvas = document.createElement('canvas');
  woodRoughCanvas.width = 256;
  woodRoughCanvas.height = 256;
  const wrCtx = woodRoughCanvas.getContext('2d')!;
  wrCtx.fillStyle = '#d8d8d8';
  wrCtx.fillRect(0, 0, 256, 256);

  const plankH = 64;
  const plankPalettes = [
    ['#a76d42', '#8b552f'],
    ['#9c6238', '#804d28'],
    ['#b3774b', '#935c36'],
  ];
  for (let row = 0; row < 8; row++) {
    const [cTop, cBot] = plankPalettes[row % plankPalettes.length];
    const pGrad = wCtx.createLinearGradient(0, row * plankH, 0, (row + 1) * plankH);
    pGrad.addColorStop(0, cTop);
    pGrad.addColorStop(1, cBot);
    wCtx.fillStyle = pGrad;
    wCtx.fillRect(0, row * plankH + 2, 512, plankH - 4);

    wCtx.fillStyle = 'rgba(255, 228, 185, 0.18)';
    wCtx.fillRect(0, row * plankH + 3, 512, 5);

    wCtx.strokeStyle = 'rgba(48, 24, 12, 0.28)';
    wCtx.lineWidth = 2.2;
    for (let g = 0; g < 5; g++) {
      const gy = row * plankH + 13 + g * 9;
      wCtx.beginPath();
      wCtx.moveTo(0, gy);
      wCtx.bezierCurveTo(170, gy + (Math.random() - 0.5) * 9, 340, gy + (Math.random() - 0.5) * 9, 512, gy);
      wCtx.stroke();
    }
    if (row % 2 === 0) {
      const kx = ((row * 137 + 90) % 400) + 50;
      const ky = row * plankH + 32;
      wCtx.strokeStyle = 'rgba(48, 24, 12, 0.36)';
      wCtx.beginPath();
      wCtx.ellipse(kx, ky, 14, 7, 0.1, 0, Math.PI * 2);
      wCtx.stroke();
    }
    const jointX = ((row * 173) % 420) + 40;
    wCtx.fillStyle = '#2b160b';
    wCtx.fillRect(jointX, row * plankH, 5, plankH);

    // Height & roughness planks (half-res)
    const hr = row * 32;
    whCtx.fillStyle = '#dcdcdc';
    whCtx.fillRect(0, hr + 2, 256, 28);
    whCtx.fillStyle = '#282828';
    whCtx.fillRect(Math.round(jointX / 2), hr, 3, 32);
    whCtx.strokeStyle = 'rgba(180,180,180,0.45)';
    whCtx.lineWidth = 1.5;
    for (let g = 0; g < 3; g++) {
      whCtx.beginPath();
      whCtx.moveTo(0, hr + 7 + g * 7);
      whCtx.lineTo(256, hr + 7 + g * 7 + (g - 1) * 2);
      whCtx.stroke();
    }

    wrCtx.fillStyle = row % 2 === 0 ? '#787878' : '#888888'; // Warm satin wood finish
    wrCtx.fillRect(0, hr + 2, 256, 28);
  }
  const oakWood = finalizeTexture(woodCanvas, 10, 10, maxAnisotropy);
  const oakWoodNormal = finalizeTexture(buildNormalCanvas(woodHeightCanvas, 2.4), 10, 10, maxAnisotropy, false);
  const oakWoodRoughness = finalizeTexture(woodRoughCanvas, 10, 10, maxAnisotropy, false);
  textures.push(oakWood, oakWoodNormal, oakWoodRoughness);

  // 3. Stylized Burrow mossy cobblestone masonry + Normal Map
  const burrowCanvas = document.createElement('canvas');
  burrowCanvas.width = 256;
  burrowCanvas.height = 256;
  const bCtx = burrowCanvas.getContext('2d')!;
  bCtx.fillStyle = '#31261e';
  bCtx.fillRect(0, 0, 256, 256);

  const bHeightCanvas = document.createElement('canvas');
  bHeightCanvas.width = 256;
  bHeightCanvas.height = 256;
  const bhCtx = bHeightCanvas.getContext('2d')!;
  bhCtx.fillStyle = '#202020';
  bhCtx.fillRect(0, 0, 256, 256);

  const brickCols = ['#6f5a4a', '#5f4e41', '#7b6654', '#566447'];
  for (let row = 0; row < 4; row++) {
    const offset = (row % 2) * 32;
    for (let col = -1; col < 5; col++) {
      const bx = col * 64 + offset + 3;
      const by = row * 64 + 3;
      bCtx.fillStyle = brickCols[(row * 3 + col + 4) % brickCols.length];
      bCtx.beginPath();
      bCtx.roundRect(bx, by, 58, 58, 10);
      bCtx.fill();
      bCtx.fillStyle = 'rgba(255, 238, 210, 0.14)';
      bCtx.fillRect(bx + 6, by + 5, 46, 7);

      bhCtx.fillStyle = '#e0e0e0';
      bhCtx.beginPath();
      bhCtx.roundRect(bx + 2, by + 2, 54, 54, 10);
      bhCtx.fill();
    }
  }
  for (let i = 0; i < 36; i++) {
    bCtx.fillStyle = 'rgba(104, 152, 68, 0.28)';
    bCtx.beginPath();
    bCtx.arc(Math.random() * 256, Math.random() * 256, 5 + Math.random() * 9, 0, Math.PI * 2);
    bCtx.fill();
  }
  const burrowStone = finalizeTexture(burrowCanvas, 3, 2, maxAnisotropy);
  const burrowStoneNormal = finalizeTexture(buildNormalCanvas(bHeightCanvas, 3.2), 3, 2, maxAnisotropy, false);
  textures.push(burrowStone, burrowStoneNormal);

  // 4. Stylized warm veined marble countertop
  const marbleCanvas = document.createElement('canvas');
  marbleCanvas.width = 256;
  marbleCanvas.height = 256;
  const mCtx = marbleCanvas.getContext('2d')!;
  mCtx.fillStyle = '#ebe3d6';
  mCtx.fillRect(0, 0, 256, 256);
  mCtx.strokeStyle = 'rgba(130, 118, 105, 0.34)';
  for (let i = 0; i < 12; i++) {
    mCtx.lineWidth = 1.6 + Math.random() * 2.2;
    mCtx.beginPath();
    let mx = Math.random() * 256;
    let my = 0;
    mCtx.moveTo(mx, my);
    for (let s = 0; s < 5; s++) {
      mx += (Math.random() - 0.5) * 64;
      my += 52;
      mCtx.lineTo(mx, my);
    }
    mCtx.stroke();
  }
  const marbleCounter = finalizeTexture(marbleCanvas, 4, 2, maxAnisotropy);
  textures.push(marbleCounter);

  // 5. Living room & bedroom vibrant woven rug
  const rugCanvas = document.createElement('canvas');
  rugCanvas.width = 512;
  rugCanvas.height = 512;
  const rCtx = rugCanvas.getContext('2d')!;
  rCtx.fillStyle = '#a2352b';
  rCtx.fillRect(0, 0, 512, 512);
  rCtx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let y = 0; y < 512; y += 6) rCtx.fillRect(0, y, 512, 2);
  rCtx.strokeStyle = '#ebb64d';
  rCtx.lineWidth = 22;
  rCtx.strokeRect(28, 28, 456, 456);
  rCtx.strokeStyle = '#2d5c6e';
  rCtx.lineWidth = 14;
  rCtx.strokeRect(58, 58, 396, 396);
  rCtx.fillStyle = '#ebb64d';
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    rCtx.save();
    rCtx.translate(256 + Math.cos(angle) * 94, 256 + Math.sin(angle) * 94);
    rCtx.rotate(angle);
    rCtx.fillRect(-11, -24, 22, 48);
    rCtx.restore();
  }
  rCtx.beginPath();
  rCtx.arc(256, 256, 46, 0, Math.PI * 2);
  rCtx.fillStyle = '#2d5c6e';
  rCtx.fill();
  rCtx.lineWidth = 6;
  rCtx.strokeStyle = '#ebb64d';
  rCtx.stroke();
  const rugPattern = finalizeTexture(rugCanvas, 1, 1, maxAnisotropy);
  textures.push(rugPattern);

  // 6. Checkered kitchen runner/tablecloth
  const clothCanvas = document.createElement('canvas');
  clothCanvas.width = 256;
  clothCanvas.height = 256;
  const cCtx = clothCanvas.getContext('2d')!;
  cCtx.fillStyle = '#f2e8d5';
  cCtx.fillRect(0, 0, 256, 256);
  cCtx.fillStyle = 'rgba(196, 52, 42, 0.82)';
  for (let i = 0; i < 4; i++) {
    cCtx.fillRect(i * 64, 0, 32, 256);
    cCtx.fillRect(0, i * 64, 256, 32);
  }
  const tablecloth = finalizeTexture(clothCanvas, 2, 2, maxAnisotropy);
  textures.push(tablecloth);

  // 7. Curtain fabric weave
  const curtCanvas = document.createElement('canvas');
  curtCanvas.width = 256;
  curtCanvas.height = 256;
  const cuCtx = curtCanvas.getContext('2d')!;
  cuCtx.fillStyle = '#487366';
  cuCtx.fillRect(0, 0, 256, 256);
  cuCtx.fillStyle = 'rgba(255,245,220,0.12)';
  for (let x = 0; x < 256; x += 16) {
    cuCtx.fillRect(x, 0, 6, 256);
  }
  cuCtx.fillStyle = 'rgba(18,28,24,0.14)';
  for (let y = 0; y < 256; y += 8) {
    cuCtx.fillRect(0, y, 256, 2);
  }
  const curtainFabric = finalizeTexture(curtCanvas, 2, 4, maxAnisotropy);
  textures.push(curtainFabric);

  // 8. Cereal box texture
  const boxCanvas = document.createElement('canvas');
  boxCanvas.width = 256;
  boxCanvas.height = 256;
  const bxCtx = boxCanvas.getContext('2d')!;
  bxCtx.fillStyle = '#eb9226';
  bxCtx.fillRect(0, 0, 256, 256);
  bxCtx.fillStyle = '#bf3424';
  bxCtx.fillRect(14, 18, 228, 70);
  bxCtx.strokeStyle = '#fff3d1';
  bxCtx.lineWidth = 4;
  bxCtx.strokeRect(14, 18, 228, 70);
  bxCtx.fillStyle = '#fff3d1';
  bxCtx.font = 'bold 34px sans-serif';
  bxCtx.fillText('CRUNCH', 46, 65);
  bxCtx.fillStyle = '#f5ce62';
  bxCtx.beginPath();
  bxCtx.arc(128, 170, 56, 0, Math.PI * 2);
  bxCtx.fill();
  const cerealBox = finalizeTexture(boxCanvas, 1, 1, maxAnisotropy);
  textures.push(cerealBox);

  // 9. Matchbox label
  const matchCanvas = document.createElement('canvas');
  matchCanvas.width = 256;
  matchCanvas.height = 128;
  const maCtx = matchCanvas.getContext('2d')!;
  maCtx.fillStyle = '#cf3b29';
  maCtx.fillRect(0, 0, 256, 128);
  maCtx.fillStyle = '#f7e1ad';
  maCtx.fillRect(18, 18, 220, 92);
  maCtx.strokeStyle = '#2b1b12';
  maCtx.lineWidth = 4;
  maCtx.strokeRect(18, 18, 220, 92);
  maCtx.fillStyle = '#2b1b12';
  maCtx.font = 'bold 32px sans-serif';
  maCtx.fillText('MATCHES', 44, 75);
  const matchboxLabel = finalizeTexture(matchCanvas, 1, 1, maxAnisotropy);
  textures.push(matchboxLabel);

  // 10. Vibrant stylized cheese pores
  const cheeseCanvas = document.createElement('canvas');
  cheeseCanvas.width = 256;
  cheeseCanvas.height = 256;
  const chCtx = cheeseCanvas.getContext('2d')!;
  chCtx.fillStyle = '#f7c839';
  chCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 24; i++) {
    const cx = Math.random() * 256;
    const cy = Math.random() * 256;
    const r = 6 + Math.random() * 14;
    chCtx.fillStyle = '#c48312';
    chCtx.beginPath();
    chCtx.arc(cx, cy, r, 0, Math.PI * 2);
    chCtx.fill();
    chCtx.fillStyle = 'rgba(255, 240, 165, 0.35)';
    chCtx.beginPath();
    chCtx.arc(cx - r * 0.2, cy - r * 0.2, r * 0.45, 0, Math.PI * 2);
    chCtx.fill();
  }
  const cheeseRind = finalizeTexture(cheeseCanvas, 1, 1, maxAnisotropy);
  textures.push(cheeseRind);

  // 11. Soft radial contact shadow
  const shCanvas = document.createElement('canvas');
  shCanvas.width = 128;
  shCanvas.height = 128;
  const shCtx = shCanvas.getContext('2d')!;
  const grad = shCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(18,12,26,0.62)');
  grad.addColorStop(0.6, 'rgba(18,12,26,0.24)');
  grad.addColorStop(1, 'rgba(18,12,26,0)');
  shCtx.fillStyle = grad;
  shCtx.fillRect(0, 0, 128, 128);
  const contactShadow = finalizeTexture(shCanvas, 1, 1, maxAnisotropy);
  contactShadow.wrapS = THREE.ClampToEdgeWrapping;
  contactShadow.wrapT = THREE.ClampToEdgeWrapping;
  textures.push(contactShadow);

  // 12. Stylized UE5 painted outdoor grass lawn with grass tufts & wildflowers
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = 256;
  grassCanvas.height = 256;
  const gCtx = grassCanvas.getContext('2d')!;
  gCtx.fillStyle = '#569442';
  gCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 200; i++) {
    gCtx.fillStyle = i % 3 === 0 ? '#6ab04c' : i % 3 === 1 ? '#457a34' : '#78bf56';
    const gx = Math.random() * 256;
    const gy = Math.random() * 256;
    gCtx.fillRect(gx, gy, 4 + Math.random() * 5, 8 + Math.random() * 10);
  }
  for (let d = 0; d < 14; d++) {
    const dx = 12 + Math.random() * 232;
    const dy = 12 + Math.random() * 232;
    gCtx.fillStyle = d % 3 === 0 ? '#fff6d6' : '#ffe373';
    gCtx.beginPath();
    gCtx.arc(dx, dy, 3.2, 0, Math.PI * 2);
    gCtx.fill();
  }
  const grassLawn = finalizeTexture(grassCanvas, 14, 6, maxAnisotropy);
  textures.push(grassLawn);

  // 13. Stylized cobblestone walkway + Normal Map
  const cobCanvas = document.createElement('canvas');
  cobCanvas.width = 256;
  cobCanvas.height = 256;
  const coCtx = cobCanvas.getContext('2d')!;
  coCtx.fillStyle = '#4a423b';
  coCtx.fillRect(0, 0, 256, 256);

  const cobHeightCanvas = document.createElement('canvas');
  cobHeightCanvas.width = 256;
  cobHeightCanvas.height = 256;
  const cohCtx = cobHeightCanvas.getContext('2d')!;
  cohCtx.fillStyle = '#202020';
  cohCtx.fillRect(0, 0, 256, 256);

  const stoneShades = ['#9c9386', '#877e72', '#aba294'];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const sx = (col * 64 + (row % 2) * 28) % 256;
      const sy = row * 64 + 4;
      coCtx.fillStyle = stoneShades[(row + col) % 3];
      coCtx.beginPath();
      coCtx.roundRect(sx, sy, 56, 54, 12);
      coCtx.fill();
      coCtx.fillStyle = 'rgba(255,245,230,0.18)';
      coCtx.fillRect(sx + 8, sy + 6, 40, 7);

      cohCtx.fillStyle = '#e5e5e5';
      cohCtx.beginPath();
      cohCtx.roundRect(sx + 2, sy + 2, 52, 50, 12);
      cohCtx.fill();
    }
  }
  const cobblePath = finalizeTexture(cobCanvas, 2, 4, maxAnisotropy);
  const cobblePathNormal = finalizeTexture(buildNormalCanvas(cobHeightCanvas, 2.8), 2, 4, maxAnisotropy, false);
  textures.push(cobblePath, cobblePathNormal);

  // 14. Stylized cozy wallpaper stripes
  const wpCanvas = document.createElement('canvas');
  wpCanvas.width = 256;
  wpCanvas.height = 256;
  const wpCtx = wpCanvas.getContext('2d')!;
  wpCtx.fillStyle = '#c9bba0';
  wpCtx.fillRect(0, 0, 256, 256);
  wpCtx.fillStyle = 'rgba(138, 120, 92, 0.25)';
  for (let x = 0; x < 256; x += 32) {
    wpCtx.fillRect(x, 0, 14, 256);
  }
  wpCtx.fillStyle = 'rgba(255, 245, 224, 0.14)';
  for (let x = 16; x < 256; x += 32) {
    wpCtx.fillRect(x, 0, 4, 256);
  }
  const wallpaperStripes = finalizeTexture(wpCanvas, 6, 2, maxAnisotropy);
  textures.push(wallpaperStripes);

  // 15. Cozy stylized patchwork bed quilt
  const quiltCanvas = document.createElement('canvas');
  quiltCanvas.width = 256;
  quiltCanvas.height = 256;
  const qCtx = quiltCanvas.getContext('2d')!;
  const qColors = ['#4d82a3', '#a6473b', '#d9a441', '#4d8259'];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      qCtx.fillStyle = qColors[(x * 3 + y) % qColors.length];
      qCtx.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
      qCtx.strokeStyle = 'rgba(255, 244, 220, 0.55)';
      qCtx.lineWidth = 2.5;
      qCtx.setLineDash([6, 4]);
      qCtx.strokeRect(x * 64 + 7, y * 64 + 7, 50, 50);
      qCtx.setLineDash([]);
    }
  }
  const bedQuilt = finalizeTexture(quiltCanvas, 2, 2, maxAnisotropy);
  textures.push(bedQuilt);

  // 16. Stylized Painterly Wall Artworks (Landscape & Cozy Still Life)
  const art1Canvas = document.createElement('canvas');
  art1Canvas.width = 256;
  art1Canvas.height = 192;
  const a1 = art1Canvas.getContext('2d')!;
  const skyGrad = a1.createLinearGradient(0, 0, 0, 120);
  skyGrad.addColorStop(0, '#4479b5');
  skyGrad.addColorStop(1, '#f4c785');
  a1.fillStyle = skyGrad;
  a1.fillRect(0, 0, 256, 192);
  a1.fillStyle = '#fff1b8';
  a1.beginPath();
  a1.arc(185, 58, 22, 0, Math.PI * 2);
  a1.fill();
  a1.fillStyle = '#5d738d';
  a1.beginPath();
  a1.moveTo(0, 125);
  a1.lineTo(75, 62);
  a1.lineTo(145, 118);
  a1.lineTo(205, 74);
  a1.lineTo(256, 125);
  a1.lineTo(256, 192);
  a1.lineTo(0, 192);
  a1.fill();
  a1.fillStyle = '#4c8044';
  a1.fillRect(0, 124, 256, 68);
  a1.fillStyle = '#335c31';
  for (let i = 0; i < 6; i++) {
    a1.beginPath();
    a1.arc(24 + i * 42, 134 + (i % 2) * 6, 18, 0, Math.PI * 2);
    a1.fill();
  }
  const paintingLandscape = finalizeTexture(art1Canvas, 1, 1, maxAnisotropy);
  textures.push(paintingLandscape);

  const art2Canvas = document.createElement('canvas');
  art2Canvas.width = 256;
  art2Canvas.height = 192;
  const a2 = art2Canvas.getContext('2d')!;
  a2.fillStyle = '#362b2c';
  a2.fillRect(0, 0, 256, 192);
  a2.fillStyle = '#80573a';
  a2.fillRect(0, 132, 256, 60);
  // Stylized golden pitcher + giant cheese wheel
  a2.fillStyle = '#d4a03a';
  a2.beginPath();
  a2.ellipse(98, 108, 26, 34, 0, 0, Math.PI * 2);
  a2.fill();
  a2.fillRect(88, 62, 20, 24);
  a2.fillStyle = '#f2be3d';
  a2.beginPath();
  a2.moveTo(132, 136);
  a2.lineTo(210, 120);
  a2.lineTo(192, 92);
  a2.closePath();
  a2.fill();
  a2.fillStyle = '#bf392b';
  a2.beginPath();
  a2.arc(152, 132, 14, 0, Math.PI * 2);
  a2.fill();
  const paintingStillLife = finalizeTexture(art2Canvas, 1, 1, maxAnisotropy);
  textures.push(paintingStillLife);

  // 17. Aqua & Cream Bathroom Mosaic Ceramic Tiles
  const bathCanvas = document.createElement('canvas');
  bathCanvas.width = 256;
  bathCanvas.height = 256;
  const baCtx = bathCanvas.getContext('2d')!;
  baCtx.fillStyle = '#cbe7ea';
  baCtx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const bx = col * 64 + 3;
      const by = row * 64 + 3;
      baCtx.fillStyle = (row + col) % 2 === 0 ? '#eff8fa' : '#7ac7cf';
      baCtx.beginPath();
      baCtx.roundRect(bx, by, 58, 58, 6);
      baCtx.fill();
      baCtx.fillStyle = 'rgba(255,255,255,0.34)';
      baCtx.fillRect(bx + 5, by + 5, 48, 8);
    }
  }
  const bathTile = finalizeTexture(bathCanvas, 6, 7, maxAnisotropy);
  textures.push(bathTile);

  // 18. Stylized Hand-Painted Giant Oak Bark for Tree with Eyes
  const barkCanvas = document.createElement('canvas');
  barkCanvas.width = 256;
  barkCanvas.height = 256;
  const bkCtx = barkCanvas.getContext('2d')!;
  bkCtx.fillStyle = '#5c3b24';
  bkCtx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 24) {
    bkCtx.fillStyle = x % 48 === 0 ? '#6e472d' : '#4a2f1c';
    bkCtx.fillRect(x, 0, 18, 256);
    bkCtx.strokeStyle = 'rgba(28, 16, 8, 0.55)';
    bkCtx.lineWidth = 3;
    bkCtx.beginPath();
    bkCtx.moveTo(x + 2, 0);
    bkCtx.bezierCurveTo(x + 8, 84, x - 3, 170, x + 3, 256);
    bkCtx.stroke();
  }
  for (let m = 0; m < 18; m++) {
    bkCtx.fillStyle = 'rgba(84, 146, 62, 0.35)';
    bkCtx.beginPath();
    bkCtx.arc(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 10, 0, Math.PI * 2);
    bkCtx.fill();
  }
  const treeBark = finalizeTexture(barkCanvas, 3, 3, maxAnisotropy);
  textures.push(treeBark);

  // 19. Warm Weathered Garden Shed Planks
  const shedCanvas = document.createElement('canvas');
  shedCanvas.width = 256;
  shedCanvas.height = 256;
  const sdCtx = shedCanvas.getContext('2d')!;
  sdCtx.fillStyle = '#7b4931';
  sdCtx.fillRect(0, 0, 256, 256);
  for (let col = 0; col < 8; col++) {
    const sx = col * 32;
    sdCtx.fillStyle = col % 2 === 0 ? '#91583b' : '#7d4a31';
    sdCtx.fillRect(sx + 1, 0, 30, 256);
    sdCtx.fillStyle = 'rgba(255, 224, 182, 0.14)';
    sdCtx.fillRect(sx + 3, 0, 4, 256);
    sdCtx.fillStyle = '#331c10';
    sdCtx.fillRect(sx, 0, 2, 256);
  }
  const shedWood = finalizeTexture(shedCanvas, 3, 2, maxAnisotropy);
  textures.push(shedWood);

  return {
    kitchenTile,
    kitchenTileNormal,
    kitchenTileRoughness,
    oakWood,
    oakWoodNormal,
    oakWoodRoughness,
    burrowStone,
    burrowStoneNormal,
    marbleCounter,
    rugPattern,
    tablecloth,
    curtainFabric,
    cerealBox,
    matchboxLabel,
    cheeseRind,
    contactShadow,
    grassLawn,
    cobblePath,
    cobblePathNormal,
    wallpaperStripes,
    bedQuilt,
    paintingLandscape,
    paintingStillLife,
    bathTile,
    treeBark,
    shedWood,
    dispose: () => {
      textures.forEach((t) => t.dispose());
    },
  };
}
