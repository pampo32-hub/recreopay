// ========================================================
// SISTEMA DE SONIDOS SIBOPAY - COMPLETAMENTE DESACTIVADO
// Todos los efectos de sonido y alertas auditivas han sido removidos a solicitud.
// ========================================================
class SoundEffects {
  constructor() {
    this.ctx = null;
    this.enabled = false;
  }

  init() {}
  playSuccess() {}
  playCoin() {}
  playScanChirp() {}
  playError() {}
  playTap() {}
  playBeep() {}
  playNotice() {}
  playTrash() {}
}

const silentInstance = new SoundEffects();

// Proxy de seguridad para asegurar que cualquier llamada desconocida sea silenciosa y segura
window.sounds = new Proxy(silentInstance, {
  get(target, prop) {
    if (prop in target) {
      return target[prop];
    }
    return function() {};
  }
});
