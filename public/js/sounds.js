// ========================================================
// SISTEMA SENSORIAL SIBOPAY: AUDIO SINTETIZADO Y HÁPTICO MÓVIL
// Sonidos sintetizados mediante Web Audio API (cero descargas, cero latencia)
// y vibración háptica táctil en dispositivos móviles (navigator.vibrate)
// ========================================================

class SensorySystem {
  constructor() {
    this.ctx = null;
    this.soundEnabled = localStorage.getItem('sibopay_sound_enabled') !== 'false';
    this.hapticEnabled = localStorage.getItem('sibopay_haptic_enabled') !== 'false';
    this.masterVolume = 0.22; // Nivel suave y agradable, no intrusivo
    this._initOnGesture = this._initOnGesture.bind(this);

    // Escuchar interacción del usuario para desbloquear AudioContext en móviles (política de navegadores)
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this._initOnGesture, { once: true, passive: true });
      window.addEventListener('keydown', this._initOnGesture, { once: true, passive: true });
    }
  }

  _initOnGesture() {
    this._getAudioContext();
  }

  _getAudioContext() {
    if (!this.ctx && (typeof window !== 'undefined')) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        try {
          this.ctx = new AudioCtx();
        } catch (e) {
          console.warn('[SensorySystem] No se pudo inicializar AudioContext:', e);
        }
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // ==========================================
  // RETROALIMENTACIÓN HÁPTICA (VIBRACIÓN TÁCTIL)
  // ==========================================
  vibrate(pattern) {
    if (!this.hapticEnabled) return;
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch (e) {}
  }

  hapticTap() {
    this.vibrate(10); // Micro-vibración sutil de 10ms
  }

  hapticSuccess() {
    this.vibrate([30, 40, 45]); // Doble pulso de confirmación
  }

  hapticScan() {
    this.vibrate(22); // Pulso nítido de detección
  }

  hapticWarning() {
    this.vibrate([40, 50, 40]);
  }

  hapticError() {
    this.vibrate([70, 50, 70]); // Pulso más marcado de advertencia/error
  }

  // ==========================================
  // SÍNTESIS DE AUDIO (WEB AUDIO API)
  // ==========================================

  // Campana suave de éxito (arpegio de 3 notas: Do - Mi - Sol)
  playSuccess() {
    this.hapticSuccess();
    if (!this.soundEnabled) return;
    const ctx = this._getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + index * 0.08);

        gain.gain.setValueAtTime(0, now + index * 0.08);
        gain.gain.linearRampToValueAtTime(this.masterVolume, now + index * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + index * 0.08);
        osc.stop(now + index * 0.08 + 0.36);
      });
    } catch (e) {}
  }

  // Sonido de moneda / pago registrado (doble tintineo metálico)
  playCoin() {
    this.hapticSuccess();
    if (!this.soundEnabled) return;
    const ctx = this._getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const tones = [987.77, 1318.51]; // B5 -> E6
      tones.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + index * 0.09);

        gain.gain.setValueAtTime(0, now + index * 0.09);
        gain.gain.linearRampToValueAtTime(this.masterVolume * 0.9, now + index * 0.09 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.09 + 0.28);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + index * 0.09);
        osc.stop(now + index * 0.09 + 0.30);
      });
    } catch (e) {}
  }

  // Chirp nítido de escáner QR o código de barras
  playScanChirp() {
    this.hapticScan();
    if (!this.soundEnabled) return;
    const ctx = this._getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(1900, now + 0.04);

      gain.gain.setValueAtTime(this.masterVolume * 0.8, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {}
  }

  // Tap acústico sutil para botones numéricos o selección
  playTap() {
    this.hapticTap();
    if (!this.soundEnabled) return;
    const ctx = this._getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.025);

      gain.gain.setValueAtTime(this.masterVolume * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.03);
    } catch (e) {}
  }

  // Tono de error o rechazo (dos tonos bajos descendentes)
  playError() {
    this.hapticError();
    if (!this.soundEnabled) return;
    const ctx = this._getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const tones = [260, 195];
      tones.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);

        gain.gain.setValueAtTime(this.masterVolume * 0.6, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 0.14);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.15);
      });
    } catch (e) {}
  }

  playBeep() {
    this.playTap();
  }

  playNotice() {
    this.playSuccess();
  }

  playTrash() {
    this.playTap();
  }

  // ==========================================
  // CONFIGURACIÓN DE PREFERENCIAS DE USUARIO
  // ==========================================
  toggleSound(enabled) {
    this.soundEnabled = (typeof enabled === 'boolean') ? enabled : !this.soundEnabled;
    localStorage.setItem('sibopay_sound_enabled', String(this.soundEnabled));
    if (this.soundEnabled) this.playTap();
    return this.soundEnabled;
  }

  toggleHaptics(enabled) {
    this.hapticEnabled = (typeof enabled === 'boolean') ? enabled : !this.hapticEnabled;
    localStorage.setItem('sibopay_haptic_enabled', String(this.hapticEnabled));
    if (this.hapticEnabled) this.hapticTap();
    return this.hapticEnabled;
  }

  isSoundEnabled() {
    return this.soundEnabled;
  }

  isHapticEnabled() {
    return this.hapticEnabled;
  }
}

// Instancia global compartida
const sensoryInstance = new SensorySystem();

// Exponer como window.sounds y window.haptics para máxima compatibilidad
window.sounds = sensoryInstance;
window.haptics = {
  tap: () => sensoryInstance.hapticTap(),
  success: () => sensoryInstance.hapticSuccess(),
  scan: () => sensoryInstance.hapticScan(),
  warning: () => sensoryInstance.hapticWarning(),
  error: () => sensoryInstance.hapticError(),
  vibrate: (p) => sensoryInstance.vibrate(p)
};
