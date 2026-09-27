// A simple synthetic hand: wrist at (x, y), fingers fanned upwards.
export function makeHand(x = 0.5, y = 0.5, size = 0.1, curl = 0) {
  const pts = [{ x, y, z: 0 }];
  for (let finger = 0; finger < 5; finger++) {
    const angle = -Math.PI / 2 + (finger - 2) * 0.35;
    for (let joint = 1; joint <= 4; joint++) {
      const r = size * (0.6 + joint * 0.3) * (1 - curl * (joint / 6));
      pts.push({ x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r, z: 0 });
    }
  }
  return pts;
}
