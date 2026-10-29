import { Vector3, MathUtils } from 'three';

export default class ThirdPersonCamera {
  distance = 5.2;
  height = 1.6;
  pitch = 18; // degrees looking down at frog character
  yaw = 0;    // degrees (0 = behind player looking towards +Z)
  smoothSpeed = 14.0;
  lookSensitivity = 1.6;

  private ctx: any;
  private currentPos = new Vector3(0, 3.2, -5.2);
  private targetEntity: any = null;

  onInit(ctx: any) {
    this.ctx = ctx;
    this.findTarget();

    if (this.targetEntity) {
      const tTransform = this.targetEntity.getTransform();
      if (tTransform && tTransform.position) {
        const frogPos = new Vector3(tTransform.position.x, tTransform.position.y, tTransform.position.z);
        const radYaw = MathUtils.degToRad(this.yaw);
        const radPitch = MathUtils.degToRad(this.pitch);
        const cosPitch = Math.cos(radPitch);
        const sinPitch = Math.sin(radPitch);

        const offset = new Vector3(
          Math.sin(radYaw) * cosPitch * this.distance,
          sinPitch * this.distance + this.height,
          -Math.cos(radYaw) * cosPitch * this.distance
        );
        this.currentPos.copy(frogPos).add(offset);
        this.updateCameraTransform(0);
      }
    }
  }

  private findTarget() {
    if (this.ctx.world) {
      this.targetEntity = this.ctx.world.getEntity('player') ||
                          this.ctx.world.findByTag('Player')?.[0];
    }
    if (!this.targetEntity && this.ctx.scene) {
      this.targetEntity = this.ctx.scene.find('FrogKnight');
    }
  }

  onUpdate(dt: number) {
    if (!this.targetEntity) {
      this.findTarget();
      if (!this.targetEntity) return;
    }

    const look = this.ctx.input?.getVector('Look');
    const turn = this.ctx.input?.getAxis('Turn');

    if (look && (Math.abs(look.x) > 0.001 || Math.abs(look.y) > 0.001)) {
      this.yaw -= look.x * this.lookSensitivity * 0.12;
      this.pitch = MathUtils.clamp(this.pitch - look.y * this.lookSensitivity * 0.08, -10, 60);
    } else if (turn && Math.abs(turn) > 0.01) {
      this.yaw -= turn * 90 * dt;
    }

    this.updateCameraTransform(dt);
  }

  private updateCameraTransform(dt: number) {
    const tTransform = this.targetEntity?.getTransform();
    if (!tTransform || !tTransform.position) return;

    const pPos = tTransform.position;
    const frogPos = new Vector3(pPos.x, pPos.y, pPos.z);

    const radYaw = MathUtils.degToRad(this.yaw);
    const radPitch = MathUtils.degToRad(this.pitch);
    const cosPitch = Math.cos(radPitch);
    const sinPitch = Math.sin(radPitch);

    // Behind player at -Z when yaw = 0, facing forward into the swamp (+Z)
    const offset = new Vector3(
      Math.sin(radYaw) * cosPitch * this.distance,
      sinPitch * this.distance + this.height,
      -Math.cos(radYaw) * cosPitch * this.distance
    );

    const desiredPos = frogPos.clone().add(offset);
    if (dt > 0) {
      const t = Math.min(1.0, this.smoothSpeed * dt);
      this.currentPos.lerp(desiredPos, t);
    } else {
      this.currentPos.copy(desiredPos);
    }

    const camTransform = this.ctx.entity?.getTransform();
    if (camTransform && camTransform.position) {
      camTransform.position.x = this.currentPos.x;
      camTransform.position.y = this.currentPos.y;
      camTransform.position.z = this.currentPos.z;

      // In Three.js / Linden Euler XYZ order:
      // rotX = pitch (positive tilts down towards frog when facing +Z)
      // rotY = 180 - yaw (yaw = 0 faces +Z)
      if (camTransform.rotation) {
        camTransform.rotation.x = this.pitch;
        camTransform.rotation.y = 180 - this.yaw;
        camTransform.rotation.z = 0;
      }

      if (this.ctx.object3D) {
        this.ctx.object3D.position.copy(this.currentPos);
        const rotXRad = MathUtils.degToRad(this.pitch);
        const rotYRad = MathUtils.degToRad(180 - this.yaw);
        this.ctx.object3D.rotation.set(rotXRad, rotYRad, 0, 'XYZ');
      }
    }
  }
}
