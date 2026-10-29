
import { Vector3, MathUtils } from 'three';

export default class BogSkitterAI {
  maxHp = 30;
  hp = 30;
  patrolRadius = 4.0;
  detectRadius = 11.0;
  attackRadius = 2.0;
  chargeSpeed = 5.2;

  private ctx: any;
  private state: 'patrol' | 'alert' | 'charge' | 'recover' | 'dead' = 'patrol';
  private spawnPos = new Vector3(0, 0.4, -64);
  private stateTimer = 0;
  private targetPlayer: any = null;
  private isDead = false;

  onInit(ctx: any) {
    this.ctx = ctx;
    const t = ctx.entity.getTransform?.();
    if (t?.position) {
      this.spawnPos.set(t.position.x, t.position.y, t.position.z);
    }
  }

  private findPlayer() {
    if (this.ctx.world) {
      this.targetPlayer = this.ctx.world.getEntity('player') ||
                          this.ctx.world.findByTag('Player')?.[0];
    }
    if (!this.targetPlayer && this.ctx.scene) {
      this.targetPlayer = this.ctx.scene.find('FrogKnight');
    }
  }

  onUpdate(dt: number) {
    if (this.isDead) return;

    if (!this.targetPlayer) {
      this.findPlayer();
      if (!this.targetPlayer) return;
    }

    const myTransform = this.ctx.entity.getTransform?.();
    const pTransform = this.targetPlayer.getTransform?.();
    if (!myTransform?.position || !pTransform?.position) return;

    const myPos = new Vector3(myTransform.position.x, myTransform.position.y, myTransform.position.z);
    const playerPos = new Vector3(pTransform.position.x, pTransform.position.y, pTransform.position.z);
    const toPlayer = playerPos.clone().sub(myPos);
    const distToPlayer = toPlayer.length();

    this.stateTimer += dt;

    switch (this.state) {
      case 'patrol': {
        const wanderX = Math.sin(this.stateTimer * 1.5) * 2.5;
        myTransform.position.x = this.spawnPos.x + wanderX;

        if (distToPlayer < this.detectRadius) {
          this.state = 'alert';
          this.stateTimer = 0;
          this.ctx.emit?.('enemy_alert', { enemyId: this.ctx.entity.id });
        }
        break;
      }

      case 'alert': {
        this.facePosition(myPos, playerPos, dt * 6.0);
        if (this.stateTimer > 0.6) {
          this.state = 'charge';
          this.stateTimer = 0;
        }
        break;
      }

      case 'charge': {
        this.facePosition(myPos, playerPos, dt * 5.0);
        toPlayer.y = 0;
        toPlayer.normalize();

        myTransform.position.x += toPlayer.x * this.chargeSpeed * dt;
        myTransform.position.z += toPlayer.z * this.chargeSpeed * dt;

        if (distToPlayer <= this.attackRadius) {
          this.ctx.emit?.('player_damaged', { amount: 15 });
          this.state = 'recover';
          this.stateTimer = 0;
        } else if (this.stateTimer > 2.5) {
          this.state = 'recover';
          this.stateTimer = 0;
        }
        break;
      }

      case 'recover': {
        if (this.stateTimer > 1.2) {
          this.state = distToPlayer < this.detectRadius ? 'alert' : 'patrol';
          this.stateTimer = 0;
        }
        break;
      }
    }
  }

  private facePosition(myPos: Vector3, targetPos: Vector3, t: number) {
    const angle = Math.atan2(targetPos.x - myPos.x, targetPos.z - myPos.z);
    const deg = MathUtils.radToDeg(angle);
    const tr = this.ctx.entity.getTransform?.();
    if (tr?.rotation) {
      tr.rotation.y = MathUtils.lerp(tr.rotation.y || 0, deg, Math.min(1.0, t));
    }
  }

  onEvent(name: string, data: any) {
    if (name === 'attack_skitter' && !this.isDead) {
      this.takeDamage(data?.damage || 10);
    }
  }

  takeDamage(amt: number) {
    if (this.isDead) return;
    this.hp -= amt;
    this.state = 'recover';
    this.stateTimer = 0;

    const tr = this.ctx.entity.getTransform?.();
    if (tr?.position) {
      tr.position.z -= 0.8;
      tr.position.y += 0.3;
    }

    if (this.hp <= 0) {
      this.die();
    }
  }

  private die() {
    this.isDead = true;
    this.state = 'dead';
    this.ctx.emit?.('skitter_defeated', {});

    const tr = this.ctx.entity.getTransform?.();
    if (tr?.position) {
      tr.position.y = -10;
    }
    this.ctx.entity.active = false;
  }
}
