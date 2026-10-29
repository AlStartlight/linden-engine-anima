
import { Vector3, MathUtils, CylinderGeometry, MeshStandardMaterial, Mesh, Color } from 'three';

interface HistoryFrame {
  x: number;
  y: number;
  z: number;
}

export default class FrogKnightController {
  maxHp = 100;
  hp = 100;
  maxGrappleDist = 24.0;
  swingStrength = 46.0;
  reelSpeed = 4.8;
  minRopeLength = 2.4;

  private ctx: any;
  private isGrappling = false;
  private anchorPoint = new Vector3();
  private anchorEntity: any = null;
  private ropeLength = 10.0;
  private grappleCooldown = 0;

  // Targeting
  private currentTarget: any = null;
  private grapplePoints: any[] = [];

  // Visual Tongue Mesh
  private tongueMesh: Mesh | null = null;
  private tongueMat: MeshStandardMaterial | null = null;

  // Combat & Dodge
  private attackCooldown = 0;
  private invulnTimer = 0;

  // Chrono Pulse & Rewind
  private pulseCooldown = 0;
  private history: HistoryFrame[] = [];
  private maxHistory = 200;
  private isRewinding = false;
  private rewindIndex = 0;
  private checkpointPos = new Vector3(0, 1.2, 0);

  // Puzzle States
  private valvesAligned = [false, false, false];
  private runeGateOpen = false;
  private bogSkitterDead = false;
  private bridgeRestored = false;
  private bridgeTimer = 0;
  private maxBridgeTime = 16.0;

  // Collectibles & Objectives
  private collectedPetals = 0;
  private petal1Collected = false;
  private petal2Collected = false;
  private petal3Collected = false;
  private currentObjective = 'Awaken at the Sunken Shrine';
  private gameWon = false;
  private gameTime = 0;
  private swingsCount = 0;

  // Cached Entities
  private runeDoorEntity: any = null;
  private temporalBridgeEntity: any = null;
  private arenaBarrierEntity: any = null;
  private skitterEntity: any = null;

  onInit(ctx: any) {
    this.ctx = ctx;

    // Create 3D visual tongue mesh
    const tongueGeo = new CylinderGeometry(0.045, 0.055, 1, 8);
    tongueGeo.translate(0, 0.5, 0);
    tongueGeo.rotateX(Math.PI / 2);

    this.tongueMat = new MeshStandardMaterial({
      color: new Color('#fb7185'),
      emissive: new Color('#e11d48'),
      emissiveIntensity: 0.7,
      roughness: 0.25,
      metalness: 0.1
    });

    this.tongueMesh = new Mesh(tongueGeo, this.tongueMat);
    this.tongueMesh.visible = false;
    if (this.ctx.three?.scene) {
      this.ctx.three.scene.add(this.tongueMesh);
    }

    // UI event bindings
    if (this.ctx.ui) {
      this.ctx.ui.on('#btn-restart', 'click', () => {
        this.ctx.scene.load('scenes/Main.lscene');
      });
      this.ctx.ui.on('#btn-play-again', 'click', () => {
        this.ctx.scene.load('scenes/Main.lscene');
      });
    }

    // Event listeners
    this.ctx.on?.('player_damaged', (data: any) => {
      this.takeDamage(data?.amount || 15);
    });

    this.ctx.on?.('skitter_defeated', () => {
      this.onBogSkitterDefeated();
    });

    this.showToast('🐸 Sir Croak awakes. Seek the Chrono Lily across the Drowned Verge.');
    this.updateObjective('Traverse the Root Crossing with Tongue Grapple [Q]');
  }

  onUpdate(dt: number) {
    this.gameTime += dt;
    if (this.grappleCooldown > 0) this.grappleCooldown -= dt;
    if (this.pulseCooldown > 0) this.pulseCooldown -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    if (this.grapplePoints.length === 0) {
      this.cacheEntities();
    }

    if (this.bridgeRestored) {
      this.bridgeTimer -= dt;
      if (this.bridgeTimer <= 0) {
        this.decayTemporalBridge();
      }
    }

    const transform = this.ctx.entity.getTransform?.();
    if (!transform || !transform.position) return;
    const frogPos = new Vector3(transform.position.x, transform.position.y, transform.position.z);

    if (!this.isRewinding) {
      this.history.push({ x: frogPos.x, y: frogPos.y, z: frogPos.z });
      if (this.history.length > this.maxHistory) this.history.shift();
    } else {
      this.processRewind(dt);
      return;
    }

    if (frogPos.y < -1.0) {
      this.triggerHazardFall();
      return;
    }

    this.scanGrappleTargets(frogPos);

    const grapplePressed = this.ctx.input.isActionJustPressed('Grapple');
    const jumpPressed = this.ctx.input.isActionJustPressed('Jump');

    if (grapplePressed) {
      if (this.isGrappling) {
        this.releaseGrapple(false);
      } else if (this.currentTarget && this.grappleCooldown <= 0) {
        this.startGrapple(this.currentTarget, frogPos);
      }
    }

    if (this.isGrappling) {
      if (jumpPressed) {
        this.releaseGrapple(true);
      } else {
        this.updateGrappleSwing(frogPos, dt);
      }
    }

    this.updateTongueVisual(frogPos);

    if (this.ctx.input.isActionJustPressed('Attack')) {
      this.performAttack(frogPos);
    }

    if (this.ctx.input.isActionJustPressed('TimePulse')) {
      this.performChronoPulse(frogPos);
    }

    if (this.ctx.input.isActionJustPressed('Interact')) {
      this.performInteraction(frogPos);
    }

    this.checkProximityTriggers(frogPos);
    this.updateHUD();
  }

  private cacheEntities() {
    const points: any[] = [];
    if (this.ctx.world?.findByTag) {
      const tagged = this.ctx.world.findByTag('GrapplePoint');
      if (tagged && Array.isArray(tagged)) {
        for (const t of tagged) points.push(t);
      }
    }
    const ids = ['living-root-anchor', 'canopy-vine-anchor', 'arena-lantern-anchor', 'bridge-grapple-chain'];
    for (const id of ids) {
      const ent = this.ctx.world?.getEntity?.(id) || this.ctx.scene?.find?.(id);
      if (ent && !points.some(p => p.id === ent.id)) points.push(ent);
    }
    this.grapplePoints = points;

    this.runeDoorEntity = this.ctx.world?.getEntity?.('rune-gate-door') || this.ctx.scene?.find?.('rune-gate-door');
    this.temporalBridgeEntity = this.ctx.world?.getEntity?.('temporal-bridge') || this.ctx.scene?.find?.('temporal-bridge');
    this.arenaBarrierEntity = this.ctx.world?.getEntity?.('arena-exit-barrier') || this.ctx.scene?.find?.('arena-exit-barrier');
    this.skitterEntity = this.ctx.world?.getEntity?.('bog-skitter') || this.ctx.scene?.find?.('bog-skitter');
  }

  private scanGrappleTargets(frogPos: Vector3) {
    let bestTarget: any = null;
    let closestDist = this.maxGrappleDist;

    let lookDir = new Vector3(0, 0, -1);
    if (this.ctx.three?.camera) {
      this.ctx.three.camera.getWorldDirection(lookDir);
    }

    for (const gp of this.grapplePoints) {
      const gt = gp.getTransform?.();
      if (!gt || !gt.position) continue;

      const gPos = new Vector3(gt.position.x, gt.position.y, gt.position.z);
      const toG = gPos.clone().sub(frogPos);
      const dist = toG.length();

      if (dist < closestDist && dist > 1.2) {
        toG.normalize();
        const dot = lookDir.dot(toG);
        if (dot > 0.35) {
          closestDist = dist;
          bestTarget = gp;
        }
      }
    }

    this.currentTarget = bestTarget;

    if (this.ctx.ui) {
      const crosshair = this.ctx.ui.query('#crosshair');
      const hint = this.ctx.ui.query('#grapple-hint');
      if (crosshair && hint) {
        if (bestTarget && !this.isGrappling) {
          crosshair.classList.add('locked');
          hint.innerText = `[Q / HOOK] TONGUE ANCHOR [${closestDist.toFixed(1)}m]`;
        } else if (!this.isGrappling) {
          crosshair.classList.remove('locked');
          hint.innerText = 'AIM AT ANCHORS TO GRAPPLE';
        }
      }
    }
  }

  private startGrapple(target: any, frogPos: Vector3) {
    const gt = target.getTransform?.();
    if (!gt || !gt.position) return;

    this.anchorEntity = target;
    this.anchorPoint.set(gt.position.x, gt.position.y, gt.position.z);
    this.ropeLength = Math.max(this.minRopeLength, frogPos.distanceTo(this.anchorPoint));
    this.isGrappling = true;
    this.swingsCount++;

    if (this.tongueMesh) this.tongueMesh.visible = true;

    if (this.ctx.movement?.addImpulse) {
      const pullDir = this.anchorPoint.clone().sub(frogPos).normalize();
      this.ctx.movement.addImpulse({
        x: pullDir.x * 6.5,
        y: Math.max(4.0, pullDir.y * 9.0),
        z: pullDir.z * 6.5
      });
    }

    if (this.ctx.ui) {
      const crosshair = this.ctx.ui.query('#crosshair');
      if (crosshair) crosshair.classList.add('locked');
      const hint = this.ctx.ui.query('#grapple-hint');
      if (hint) hint.innerText = 'SWINGING! PRESS [SPACE] TO LEAP!';
    }
  }

  private updateGrappleSwing(frogPos: Vector3, dt: number) {
    if (this.anchorEntity?.getTransform) {
      const gt = this.anchorEntity.getTransform();
      if (gt?.position) {
        this.anchorPoint.set(gt.position.x, gt.position.y, gt.position.z);
      }
    }

    const toAnchor = this.anchorPoint.clone().sub(frogPos);
    const dist = toAnchor.length();

    this.ropeLength = Math.max(this.minRopeLength, this.ropeLength - this.reelSpeed * dt);

    if (dist > this.ropeLength && this.ctx.movement?.addImpulse) {
      const tensionDir = toAnchor.clone().normalize();
      const excess = dist - this.ropeLength;
      const tensionForce = excess * this.swingStrength;

      this.ctx.movement.addImpulse({
        x: tensionDir.x * tensionForce * dt,
        y: (tensionDir.y * tensionForce + 9.8) * dt,
        z: tensionDir.z * tensionForce * dt
      });
    }

    const move = this.ctx.input.getVector('Move');
    if (move && this.ctx.movement?.addImpulse) {
      let camRight = new Vector3(1, 0, 0);
      let camForward = new Vector3(0, 0, -1);
      if (this.ctx.three?.camera) {
        this.ctx.three.camera.getWorldDirection(camForward);
        camForward.y = 0;
        camForward.normalize();
        camRight.crossVectors(new Vector3(0, 1, 0), camForward).negate().normalize();
      }

      const swayImpulse = camRight.clone().multiplyScalar(move.x * 14.0 * dt)
        .add(camForward.clone().multiplyScalar(move.y * 16.0 * dt));

      this.ctx.movement.addImpulse({
        x: swayImpulse.x,
        y: 0,
        z: swayImpulse.z
      });
    }

    if (dist < 1.3) {
      this.releaseGrapple(true);
    }
  }

  private releaseGrapple(isSlingshot: boolean) {
    this.isGrappling = false;
    this.grappleCooldown = 0.25;
    if (this.tongueMesh) this.tongueMesh.visible = false;

    if (isSlingshot && this.ctx.movement?.addImpulse) {
      let fwd = new Vector3(0, 0, -1);
      if (this.ctx.three?.camera) {
        this.ctx.three.camera.getWorldDirection(fwd);
        fwd.y = 0;
        fwd.normalize();
      }

      this.ctx.movement.addImpulse({
        x: fwd.x * 16.5,
        y: 8.8,
        z: fwd.z * 16.5
      });
      this.showToast('🚀 TONGUE SLINGSHOT LEAP!');
    }

    if (this.ctx.ui) {
      const crosshair = this.ctx.ui.query('#crosshair');
      if (crosshair) crosshair.classList.remove('locked');
      const hint = this.ctx.ui.query('#grapple-hint');
      if (hint) hint.innerText = 'TONGUE READY';
    }
  }

  private updateTongueVisual(frogPos: Vector3) {
    if (!this.tongueMesh || !this.isGrappling) {
      if (this.tongueMesh) this.tongueMesh.visible = false;
      return;
    }

    this.tongueMesh.visible = true;
    const mouthPos = frogPos.clone().add(new Vector3(0, 0.7, 0));
    const delta = this.anchorPoint.clone().sub(mouthPos);
    const dist = delta.length();

    this.tongueMesh.position.copy(mouthPos);
    this.tongueMesh.lookAt(this.anchorPoint);
    this.tongueMesh.scale.set(1, 1, dist);
  }

  private performAttack(frogPos: Vector3) {
    if (this.attackCooldown > 0) return;
    this.attackCooldown = 0.38;

    if (this.skitterEntity && !this.bogSkitterDead) {
      const st = this.skitterEntity.getTransform?.();
      if (st?.position) {
        const sPos = new Vector3(st.position.x, st.position.y, st.position.z);
        const dist = frogPos.distanceTo(sPos);

        if (dist < 2.6) {
          this.ctx.emit?.('attack_skitter', { damage: 10 });
          this.showToast('⚔️ Sword Strike! Hit Bog Skitter!');
          return;
        }
      }
    }

    this.showToast('⚔️ Sword Slash!');
  }

  private performChronoPulse(frogPos: Vector3) {
    if (this.pulseCooldown > 0) return;
    this.pulseCooldown = 4.5;
    this.showToast('🌀 CHRONO PULSE! Temporal Waves Radiate!');

    // Check proximity to Drowned Bridge (Z ~ -84)
    if (Math.abs(frogPos.z - (-84)) < 15 && !this.bridgeRestored) {
      this.restoreTemporalBridge();
    }
  }

  private restoreTemporalBridge() {
    this.bridgeRestored = true;
    this.bridgeTimer = this.maxBridgeTime;

    if (this.temporalBridgeEntity) {
      const bt = this.temporalBridgeEntity.getTransform?.();
      if (bt?.position) {
        bt.position.y = 0.3;
      }
    }
    this.showToast('✨ TEMPORAL RESONANCE! The Ancient Bridge is Restored! (16s)');
    this.updateObjective('Cross the Drowned Bridge before temporal decay!');
  }

  private decayTemporalBridge() {
    this.bridgeRestored = false;
    if (this.temporalBridgeEntity) {
      const bt = this.temporalBridgeEntity.getTransform?.();
      if (bt?.position) {
        bt.position.y = -3.5;
      }
    }
    this.showToast('⏳ The temporal bridge has faded into echoes.');
  }

  private performInteraction(frogPos: Vector3) {
    // Water Valves (Z ~ -36 to -38)
    const valves = [
      { id: 'valve-1', pos: new Vector3(-4, 1.05, -37), idx: 0 },
      { id: 'valve-2', pos: new Vector3(0, 1.05, -36), idx: 1 },
      { id: 'valve-3', pos: new Vector3(4, 1.05, -37), idx: 2 }
    ];

    for (const v of valves) {
      if (frogPos.distanceTo(v.pos) < 2.2) {
        this.valvesAligned[v.idx] = !this.valvesAligned[v.idx];
        const stateStr = this.valvesAligned[v.idx] ? 'FLOWING' : 'CLOSED';
        this.showToast(`🌊 Water Valve ${v.idx + 1} turned: ${stateStr}`);

        const vent = this.ctx.world?.getEntity?.(v.id) || this.ctx.scene?.find?.(v.id);
        if (vent?.getTransform) {
          const vt = vent.getTransform();
          if (vt?.rotation) vt.rotation.y += 90;
        }

        if (this.valvesAligned[0] && this.valvesAligned[1] && this.valvesAligned[2] && !this.runeGateOpen) {
          this.openRuneGate();
        }
        return;
      }
    }

    // Chrono Altar (Beat 7: Z ~ -107)
    const altarPos = new Vector3(0, 1.45, -107);
    if (frogPos.distanceTo(altarPos) < 3.2 && !this.gameWon) {
      this.communeWithChronoLily();
      return;
    }
  }

  private openRuneGate() {
    this.runeGateOpen = true;
    this.showToast('✨ ALL THREE STREAMS ALIGNED! The Rune Gate Opens!');
    if (this.runeDoorEntity) {
      const dt = this.runeDoorEntity.getTransform?.();
      if (dt?.position) {
        dt.position.y = -3.5;
      }
    }
    this.updateObjective('Enter Regent’s Watch & Vanquish the Sentinel');
  }

  private onBogSkitterDefeated() {
    this.bogSkitterDead = true;
    this.showToast('🏆 BOG SKITTER VANQUISHED! Arena Barrier Dissolves!');
    if (this.arenaBarrierEntity) {
      const bt = this.arenaBarrierEntity.getTransform?.();
      if (bt?.position) {
        bt.position.y = -5.0;
      }
    }
    this.updateObjective('Pulse the Drowned Bridge into existence [R]');
  }

  private checkProximityTriggers(frogPos: Vector3) {
    // Petal 1: Lily Pool [-3, 1.3, -21]
    if (!this.petal1Collected && frogPos.distanceTo(new Vector3(-3, 1.3, -21)) < 2.0) {
      this.collectPetal(1, 'Petal of the Primordial Mire: "Before the capital sank, the Chrono Lily breathed eternal spring..."');
      const p1 = this.ctx.world?.getEntity?.('petal-1-collectible') || this.ctx.scene?.find?.('petal-1-collectible');
      if (p1) p1.active = false;
    }

    // Petal 2: Ruin Alcove [-6.5, 1.6, -45]
    if (!this.petal2Collected && frogPos.distanceTo(new Vector3(-6.5, 1.6, -45)) < 2.0) {
      this.collectPetal(2, 'Petal of the Royal Mason: "The three luminous streams bound time into stone and water..."');
      const p2 = this.ctx.world?.getEntity?.('petal-2-collectible') || this.ctx.scene?.find?.('petal-2-collectible');
      if (p2) p2.active = false;
    }

    // Petal 3: Chrono Altar [0, 2.1, -107]
    if (!this.petal3Collected && frogPos.distanceTo(new Vector3(0, 2.1, -107)) < 2.5) {
      this.collectPetal(3, 'Petal of the Chrono Lily: "The time loop preserves Nymbralis, awaiting the true Frog Knight."');
      const p3 = this.ctx.world?.getEntity?.('petal-3-collectible') || this.ctx.scene?.find?.('petal-3-collectible');
      if (p3) p3.active = false;
    }

    // Checkpoint 2 update
    if (frogPos.z < -90 && this.checkpointPos.z > -90) {
      this.checkpointPos.set(0, 1.2, -94);
      this.showToast('📌 Checkpoint Reached: Sanctuary Threshold!');
      this.updateObjective('Reach the Chrono Lily & Commune at the Sacred Altar');
    }

    if (this.ctx.ui) {
      const interactPrompt = this.ctx.ui.query('#interact-prompt');
      if (interactPrompt) {
        let showPrompt = false;
        let promptText = '';

        if (frogPos.distanceTo(new Vector3(-4, 1.05, -37)) < 2.2 ||
            frogPos.distanceTo(new Vector3(0, 1.05, -36)) < 2.2 ||
            frogPos.distanceTo(new Vector3(4, 1.05, -37)) < 2.2) {
          showPrompt = true;
          promptText = '[E / USE] Turn Water Valve';
        } else if (frogPos.distanceTo(new Vector3(0, 1.45, -107)) < 3.2) {
          showPrompt = true;
          promptText = '[E / USE] Commune with Chrono Lily';
        }

        if (showPrompt) {
          interactPrompt.innerText = promptText;
          interactPrompt.style.display = 'block';
        } else {
          interactPrompt.style.display = 'none';
        }
      }
    }
  }

  private collectPetal(num: number, lore: string) {
    if (num === 1) this.petal1Collected = true;
    if (num === 2) this.petal2Collected = true;
    if (num === 3) this.petal3Collected = true;
    this.collectedPetals++;

    this.showToast(`🌸 MEMORY PETAL ${this.collectedPetals}/3 DISCOVERED!\n${lore}`);

    if (this.ctx.ui) {
      const el = this.ctx.ui.query(`#petal-badge-${num}`);
      if (el) el.classList.add('active');
    }
  }

  private communeWithChronoLily() {
    this.gameWon = true;
    this.showToast('🌟 THE TIME LOOP UNLOCKS! You have preserved the memory of Nymbralis!');

    if (this.ctx.ui) {
      const modal = this.ctx.ui.query('#victory-modal');
      if (modal) modal.classList.add('visible');

      const timeEl = this.ctx.ui.query('#stat-time');
      if (timeEl) timeEl.innerText = `${Math.floor(this.gameTime / 60)}m ${Math.floor(this.gameTime % 60)}s`;

      const petalEl = this.ctx.ui.query('#stat-petals');
      if (petalEl) petalEl.innerText = `${this.collectedPetals}/3`;

      const swingEl = this.ctx.ui.query('#stat-swings');
      if (swingEl) swingEl.innerText = `${this.swingsCount}`;
    }
  }

  takeDamage(amt: number) {
    if (this.invulnTimer > 0) return;
    this.invulnTimer = 0.5;
    this.hp = Math.max(0, this.hp - amt);
    this.showToast(`⚠️ Sir Croak took ${amt} damage! (${this.hp} HP)`);

    if (this.hp <= 0) {
      this.triggerHazardFall();
    }
  }

  private triggerHazardFall() {
    this.hp = this.maxHp;
    this.releaseGrapple(false);
    this.showToast('🌀 Temporal Loop Restored: Respawned at Checkpoint!');
    if (this.ctx.movement?.teleport) {
      this.ctx.movement.teleport(this.checkpointPos.x, this.checkpointPos.y, this.checkpointPos.z);
    }
  }

  private processRewind(dt: number) {
    this.rewindIndex -= Math.max(2, Math.round(180 * dt));
    if (this.rewindIndex <= 0) {
      this.rewindIndex = 0;
      this.isRewinding = false;
      const targetFrame = this.history[0];
      if (this.ctx.movement?.teleport) {
        this.ctx.movement.teleport(targetFrame.x, targetFrame.y + 0.3, targetFrame.z);
      }
      this.history = [];
      return;
    }
    const frame = this.history[this.rewindIndex];
    if (this.ctx.movement?.teleport) {
      this.ctx.movement.teleport(frame.x, frame.y, frame.z);
    }
  }

  private updateObjective(obj: string) {
    this.currentObjective = obj;
    if (this.ctx.ui) {
      const el = this.ctx.ui.query('#objective-text');
      if (el) el.innerText = obj;
    }
  }

  private updateHUD() {
    if (!this.ctx.ui) return;

    const hpBar = this.ctx.ui.query('#hp-bar-fill');
    if (hpBar) {
      const pct = Math.max(0, Math.min(100, (this.hp / this.maxHp) * 100));
      hpBar.style.width = `${pct}%`;
    }

    const pulseGauge = this.ctx.ui.query('#pulse-status');
    if (pulseGauge) {
      if (this.pulseCooldown > 0) {
        pulseGauge.innerText = `PULSE: ${this.pulseCooldown.toFixed(1)}s`;
        pulseGauge.style.color = '#94a3b8';
      } else {
        pulseGauge.innerText = 'CHRONO PULSE [R] READY';
        pulseGauge.style.color = '#38bdf8';
      }
    }

    const bridgeIndicator = this.ctx.ui.query('#bridge-timer-wrap');
    if (bridgeIndicator) {
      if (this.bridgeRestored) {
        bridgeIndicator.style.display = 'block';
        const timerText = this.ctx.ui.query('#bridge-timer-text');
        if (timerText) timerText.innerText = `TEMPORAL BRIDGE: ${this.bridgeTimer.toFixed(1)}s`;
      } else {
        bridgeIndicator.style.display = 'none';
      }
    }
  }

  private showToast(msg: string) {
    if (!this.ctx.ui) return;
    const toast = this.ctx.ui.query('#toast');
    if (toast) {
      toast.innerText = msg;
      toast.classList.add('visible');
      setTimeout(() => {
        toast.classList.remove('visible');
      }, 3500);
    }
  }
}
