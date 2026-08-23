// @ts-nocheck
const Phaser = window.Phaser;
import { ensureRoomCodeBadge, ensureSoundToggle } from '../ui/dom';
import { appState } from '../state';
import { audioDirector } from '../audio/AudioDirector';
import { network } from '../net/NetworkManager';
export class BaseBowlingScene extends Phaser.Scene {
    setupBaseScene() {
        audioDirector.setScene(this.scene.key);
        ensureSoundToggle();
        ensureRoomCodeBadge(appState.room?.code);
        this.drawBowlingBackground();
        this.resizeHandler = () => this.drawBowlingBackground();
        this.scale.on('resize', this.resizeHandler);
        const removeKickedListener = network.on('kicked', (message) => {
            appState.resetRoom();
            alert(message);
            this.scene.start('StartScene');
        });
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            removeKickedListener();
            if (this.resizeHandler)
                this.scale.off('resize', this.resizeHandler);
        });
    }
    drawBowlingBackground() {
        const w = this.scale.width;
        const h = this.scale.height;
        this.backgroundGraphics?.destroy();
        const g = this.add.graphics().setDepth(-50);
        this.backgroundGraphics = g;
        g.fillStyle(0x180a27, 1).fillRect(0, 0, w, h);
        g.fillStyle(0x31164e, 1).fillRect(0, 0, w, h * 0.36);
        g.fillStyle(0x4d2670, 0.6).fillCircle(w * 0.18, h * 0.12, Math.max(90, w * 0.11));
        g.fillStyle(0x722f4b, 0.45).fillCircle(w * 0.84, h * 0.16, Math.max(100, w * 0.13));
        const floorY = h * 0.36;
        g.fillStyle(0xd89047, 1).fillRect(0, floorY, w, h - floorY);
        const stripe = Math.max(30, w / 18);
        for (let x = 0; x < w + stripe; x += stripe) {
            g.fillStyle((Math.floor(x / stripe) % 2 === 0) ? 0xe4a458 : 0xcf813a, 1);
            g.fillRect(x, floorY, stripe, h - floorY);
        }
        // Stylised lane arrows / pins for a recognisable bowling feel before art assets arrive.
        g.fillStyle(0xffe8bd, 0.25);
        for (let i = 0; i < 7; i++) {
            const cx = (i + 0.5) * (w / 7);
            g.fillTriangle(cx, floorY + 12, cx - 13, floorY + 34, cx + 13, floorY + 34);
        }
        // Cartoon turkey feathers silhouette behind the UI.
        const tx = w * 0.5;
        const ty = Math.min(h * 0.22, 170);
        const featherRadius = Math.min(w, h) * 0.12;
        [0xbf3f45, 0xe46b38, 0xf6a83b, 0xe9cd4b, 0xe46b38, 0xbf3f45].forEach((color, i, arr) => {
            const angle = Phaser.Math.DegToRad(-65 + (130 / (arr.length - 1)) * i);
            g.fillStyle(color, 0.62);
            g.fillEllipse(tx + Math.sin(angle) * featherRadius * 1.25, ty - Math.cos(angle) * featherRadius * 0.35, featherRadius * 0.56, featherRadius * 1.2);
        });
    }
}
