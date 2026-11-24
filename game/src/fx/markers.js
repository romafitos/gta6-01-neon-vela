// World markers: glowing light columns with a ground ring, used for mission objectives,
// mission starts, race checkpoints and the garage. Pooled and recoloured, never recreated.
import * as THREE from 'three';

const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
const ringGeo = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);

export function createMarkers(game) {
  const pool = [];
  const markers = {
    list: pool,
    add(x, z, opts = {}) {
      let m = pool.find((q) => !q.active);
      if (!m) {
        const beamMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
        const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        beam.frustumCulled = false;
        game.scene.add(beam, ring);
        m = { beam, ring, active: false };
        pool.push(m);
      }
      const r = opts.radius ?? 3, h = opts.height ?? 40;
      m.active = true; m.x = x; m.z = z; m.r = r; m.kind = opts.kind ?? 'objective'; m.label = opts.label ?? '';
      m.color = opts.color ?? 0xffd23f;
      m.beam.material.color.setHex(m.color); m.ring.material.color.setHex(m.color);
      m.beam.position.set(x, 0, z); m.beam.scale.set(r * 0.35, h, r * 0.35);
      m.ring.position.set(x, 0.15, z); m.ring.scale.setScalar(r);
      m.beam.visible = m.ring.visible = true;
      return m;
    },
    remove(m) {
      if (!m) return;
      m.active = false; m.beam.visible = m.ring.visible = false;
    },
    clearKind(kind) { for (const m of pool) if (m.active && m.kind === kind) markers.remove(m); },
    active() { return pool.filter((m) => m.active); },
    update(t) {
      for (const m of pool) {
        if (!m.active) continue;
        const pulse = 0.85 + Math.sin(t * 4) * 0.15;
        m.ring.scale.setScalar(m.r * pulse);
        m.beam.material.opacity = 0.22 + Math.sin(t * 3) * 0.08;
      }
    },
  };
  return markers;
}
