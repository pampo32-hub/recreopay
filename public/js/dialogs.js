// ========================================================
// SISTEMA GLOBAL DE MODALES Y DIÁLOGOS DE SIBOPAY
// Reemplaza window.alert y window.confirm por modales integrados de la página
// ========================================================
(function() {
  function ensureDialogDom() {
    let backdrop = document.getElementById('appGlobalDialogBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'appGlobalDialogBackdrop';
      backdrop.className = 'app-dialog-backdrop';
      backdrop.innerHTML = `
        <div class="app-dialog-card" onclick="event.stopPropagation()">
          <div class="app-dialog-icon info" id="appGlobalDialogIcon">ℹ️</div>
          <h3 class="app-dialog-title" id="appGlobalDialogTitle">Aviso</h3>
          <p class="app-dialog-message" id="appGlobalDialogMessage"></p>
          <div class="app-dialog-actions" id="appGlobalDialogActions">
            <button type="button" class="app-dialog-btn app-dialog-btn-primary" id="appGlobalDialogBtnConfirm">Entendido</button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);

      // Cerrar con Escape o confirmar con Enter
      document.addEventListener('keydown', (e) => {
        if (!backdrop.classList.contains('active')) return;
        if (e.key === 'Escape') {
          const cancelBtn = document.getElementById('appGlobalDialogBtnCancel');
          if (cancelBtn) {
            cancelBtn.click();
          } else {
            const confirmBtn = document.getElementById('appGlobalDialogBtnConfirm');
            if (confirmBtn) confirmBtn.click();
          }
        } else if (e.key === 'Enter') {
          const confirmBtn = document.getElementById('appGlobalDialogBtnConfirm');
          if (confirmBtn) confirmBtn.click();
        }
      });
    }
    return backdrop;
  }

  function showAppAlert(options) {
    return new Promise((resolve) => {
      const opts = typeof options === 'string' ? { message: options } : (options || {});
      const backdrop = ensureDialogDom();
      const iconEl = document.getElementById('appGlobalDialogIcon');
      const titleEl = document.getElementById('appGlobalDialogTitle');
      const msgEl = document.getElementById('appGlobalDialogMessage');
      const actionsEl = document.getElementById('appGlobalDialogActions');

      let type = opts.type || 'info';
      let title = opts.title;
      let icon = 'ℹ️';

      // Auto-detección por contenido si es alerta genérica
      const msgLower = (opts.message || '').toLowerCase();
      if (!opts.type) {
        if (msgLower.includes('éxito') || msgLower.includes('aprobada') || msgLower.includes('guardad') || msgLower.includes('bienvenido') || msgLower.includes('confirmad')) {
          type = 'success';
        } else if (msgLower.includes('error') || msgLower.includes('falló') || msgLower.includes('rechazad') || msgLower.includes('denegad')) {
          type = 'error';
        } else if (msgLower.includes('atención') || msgLower.includes('cuidado') || msgLower.includes('límite') || msgLower.includes('bloquead')) {
          type = 'warning';
        }
      }

      if (type === 'success') icon = '✅';
      else if (type === 'error' || type === 'danger') icon = '🚫';
      else if (type === 'warning') icon = '⚠️';
      else if (type === 'question') icon = '❓';
      else icon = 'ℹ️';

      if (!title) {
        if (type === 'success') title = '¡Operación Exitosa!';
        else if (type === 'error' || type === 'danger') title = 'Aviso del Sistema';
        else if (type === 'warning') title = 'Atención';
        else title = 'Información';
      }

      iconEl.className = `app-dialog-icon ${type}`;
      iconEl.textContent = icon;
      titleEl.textContent = title;
      msgEl.textContent = opts.message || '';

      const btnConfirmText = opts.confirmText || 'Entendido';
      const btnClass = type === 'success' ? 'app-dialog-btn-success' : (type === 'error' || type === 'danger' ? 'app-dialog-btn-danger' : 'app-dialog-btn-primary');

      actionsEl.innerHTML = `
        <button type="button" class="app-dialog-btn ${btnClass}" id="appGlobalDialogBtnConfirm">${btnConfirmText}</button>
      `;

      const confirmBtn = document.getElementById('appGlobalDialogBtnConfirm');
      confirmBtn.onclick = () => {
        backdrop.classList.remove('active');
        resolve(true);
      };

      backdrop.classList.add('active');
      setTimeout(() => confirmBtn.focus(), 50);
    });
  }

  function showAppConfirm(options) {
    return new Promise((resolve) => {
      const opts = typeof options === 'string' ? { message: options } : (options || {});
      const backdrop = ensureDialogDom();
      const iconEl = document.getElementById('appGlobalDialogIcon');
      const titleEl = document.getElementById('appGlobalDialogTitle');
      const msgEl = document.getElementById('appGlobalDialogMessage');
      const actionsEl = document.getElementById('appGlobalDialogActions');

      const isDanger = Boolean(opts.danger || opts.type === 'danger' || (opts.message || '').toLowerCase().includes('eliminar') || (opts.message || '').toLowerCase().includes('revertir'));
      const type = isDanger ? 'danger' : (opts.type || 'question');
      const icon = isDanger ? '⚠️' : '❓';
      const title = opts.title || (isDanger ? '¿Confirmar Acción?' : 'Confirmación Requerida');

      iconEl.className = `app-dialog-icon ${type}`;
      iconEl.textContent = icon;
      titleEl.textContent = title;
      msgEl.textContent = opts.message || '';

      const btnConfirmText = opts.confirmText || (isDanger ? 'Sí, continuar' : 'Confirmar');
      const btnCancelText = opts.cancelText || 'Cancelar';
      const btnClass = isDanger ? 'app-dialog-btn-danger' : 'app-dialog-btn-primary';

      actionsEl.innerHTML = `
        <button type="button" class="app-dialog-btn app-dialog-btn-secondary" id="appGlobalDialogBtnCancel">${btnCancelText}</button>
        <button type="button" class="app-dialog-btn ${btnClass}" id="appGlobalDialogBtnConfirm">${btnConfirmText}</button>
      `;

      const confirmBtn = document.getElementById('appGlobalDialogBtnConfirm');
      const cancelBtn = document.getElementById('appGlobalDialogBtnCancel');

      confirmBtn.onclick = () => {
        backdrop.classList.remove('active');
        resolve(true);
      };
      cancelBtn.onclick = () => {
        backdrop.classList.remove('active');
        resolve(false);
      };

      backdrop.classList.add('active');
      setTimeout(() => confirmBtn.focus(), 50);
    });
  }

  // Exportar globalmente
  window.showAppAlert = showAppAlert;
  window.showAppConfirm = showAppConfirm;

  // Interceptar window.alert nativo para que cualquier alerta existente se convierta en modal de la app
  window.alert = function(msg) {
    return showAppAlert(msg);
  };

  // ========================================================
  // LÓGICA DEL MODAL DE RECHAZO DE SINPE (COMPARTIDO POS & ADMIN)
  // ========================================================
  let currentSinpeRejectData = null;

  function ensureSinpeRejectModalDom() {
    let modal = document.getElementById('modalRechazarSinpe');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-qr-backdrop';
      modal.id = 'modalRechazarSinpe';
      modal.style.cssText = 'display: none; z-index: 99999;';
      modal.setAttribute('onclick', 'cerrarModalRechazoSinpe(event)');
      modal.innerHTML = `
        <div class="modal-qr-card" onclick="event.stopPropagation()" style="max-width: 440px; text-align: left; padding: 22px; border-radius: 18px;">
          <!-- Encabezado -->
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1.5px solid var(--border, #e2e8f0); padding-bottom: 10px; margin-bottom: 14px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.3rem;">🚫</span>
              <div>
                <h3 style="margin: 0; font-size: 1.05rem; font-weight: 900; color: #991b1b;">Rechazar Recarga SINPE</h3>
                <span style="font-size: 0.72rem; color: var(--text-muted, #64748b);">Trazabilidad detallada para la soda y el padre</span>
              </div>
            </div>
            <button type="button" onclick="cerrarModalRechazoSinpe()" style="background: none; border: none; font-size: 1.3rem; color: var(--text-muted, #64748b); cursor: pointer; padding: 4px;">✕</button>
          </div>

          <!-- Resumen de Solicitud -->
          <div style="background: rgba(148, 163, 184, 0.08); border: 1px solid var(--border, #e2e8f0); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; font-size: 0.80rem; line-height: 1.45;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted, #64748b);">Estudiante:</span>
              <strong id="rechazoSinpeEstudiante" style="color: var(--text-main, #0f172a);">-</strong>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 3px;">
              <span style="color: var(--text-muted, #64748b);">Monto Solicitado:</span>
              <strong id="rechazoSinpeMonto" style="color: #0284c7; font-size: 0.92rem;">₡0</strong>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 3px;">
              <span style="color: var(--text-muted, #64748b);">Comprobante / Cód:</span>
              <strong id="rechazoSinpeComprobante" style="color: var(--text-main, #334155);">-</strong>
            </div>
          </div>

          <!-- Motivo de Rechazo (Opciones Rápidas) -->
          <label style="display: block; font-size: 0.78rem; font-weight: 800; color: var(--text-main, #0f172a); margin-bottom: 6px;">
            Selecciona el motivo del rechazo:
          </label>
          <div style="display: flex; flex-direction: column; gap: 7px; margin-bottom: 12px;">
            <label class="sinpe-reject-option" style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1.5px solid var(--border, #e2e8f0); border-radius: 9px; cursor: pointer; font-size: 0.78rem; font-weight: 700; color: var(--text-main, #334155);">
              <input type="radio" name="sinpeRejectReason" value="fondos_no_recibidos" checked onchange="toggleSinpeRejectInputs()">
              <span>🚫 Fondos no recibidos en cuenta bancaria</span>
            </label>
            <label class="sinpe-reject-option" style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1.5px solid var(--border, #e2e8f0); border-radius: 9px; cursor: pointer; font-size: 0.78rem; font-weight: 700; color: var(--text-main, #334155);">
              <input type="radio" name="sinpeRejectReason" value="monto_no_coincide" onchange="toggleSinpeRejectInputs()">
              <span>⚠️ Monto no coincide con comprobante</span>
            </label>
            <label class="sinpe-reject-option" style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1.5px solid var(--border, #e2e8f0); border-radius: 9px; cursor: pointer; font-size: 0.78rem; font-weight: 700; color: var(--text-main, #334155);">
              <input type="radio" name="sinpeRejectReason" value="comprobante_invalido" onchange="toggleSinpeRejectInputs()">
              <span>📄 Comprobante falso, duplicado o ilegible</span>
            </label>
            <label class="sinpe-reject-option" style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1.5px solid var(--border, #e2e8f0); border-radius: 9px; cursor: pointer; font-size: 0.78rem; font-weight: 700; color: var(--text-main, #334155);">
              <input type="radio" name="sinpeRejectReason" value="telefono_no_coincide" onchange="toggleSinpeRejectInputs()">
              <span>📱 Teléfono o destinatario no coincide</span>
            </label>
            <label class="sinpe-reject-option" style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1.5px solid var(--border, #e2e8f0); border-radius: 9px; cursor: pointer; font-size: 0.78rem; font-weight: 700; color: var(--text-main, #334155);">
              <input type="radio" name="sinpeRejectReason" value="otro" onchange="toggleSinpeRejectInputs()">
              <span>✏️ Otro motivo personalizado</span>
            </label>
          </div>

          <!-- Campo de Monto Real cuando el monto no coincide -->
          <div id="sinpeRejectMontoContainer" style="display: none; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 10px; margin-bottom: 12px;">
            <label style="display: block; font-size: 0.75rem; font-weight: 800; color: #92400e; margin-bottom: 4px;">
              ¿De cuánto era realmente el SINPE recibido? (₡):
            </label>
            <input type="number" id="sinpeRejectMontoReal" placeholder="Ej: 1000" style="width: 100%; height: 36px; padding: 0 10px; border: 1.5px solid #fcd34d; border-radius: 8px; font-size: 0.88rem; font-weight: 800; color: #92400e; box-sizing: border-box;" oninput="updateSinpeRejectPreview()">
            <span id="sinpeRejectMontoPreview" style="display: block; font-size: 0.72rem; color: #b45309; margin-top: 4px; font-weight: 600;">
              Se intentaron recargar ₡0 pero el SINPE fue de ₡0
            </span>
          </div>

          <!-- Notas o detalles adicionales -->
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: var(--text-muted, #64748b); margin-bottom: 4px;">
              Detalle u observación adicional (opcional):
            </label>
            <input type="text" id="sinpeRejectNotasExtra" placeholder="Ej: Fondos no figuran en estado bancario al corte" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 8px; font-size: 0.80rem; box-sizing: border-box;">
          </div>

          <!-- Botones de Acción -->
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button type="button" onclick="cerrarModalRechazoSinpe()" class="btn-saas btn-saas-outline" style="height: 36px; padding: 0 14px; font-weight: 700; cursor: pointer;">
              Cancelar
            </button>
            <button type="button" id="btnConfirmarRechazoSinpe" onclick="confirmarRechazoSinpeModal()" class="btn-saas" style="height: 36px; padding: 0 16px; background: #dc2626; color: #ffffff; border: 1px solid #dc2626; font-weight: 800; cursor: pointer;">
              Confirmar Rechazo
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    } else if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    return modal;
  }

  window.abrirModalRechazoSinpe = function({ id, estudiante_nombre, monto_colones, comprobante, onConfirm }) {
    currentSinpeRejectData = {
      id,
      estudiante_nombre: estudiante_nombre || 'Estudiante',
      monto_colones: Number(monto_colones || 0),
      comprobante: comprobante || 'N/A',
      onConfirm
    };

    const modal = ensureSinpeRejectModalDom();
    if (!modal) return;

    const estEl = document.getElementById('rechazoSinpeEstudiante');
    const montoEl = document.getElementById('rechazoSinpeMonto');
    const compEl = document.getElementById('rechazoSinpeComprobante');
    const realInput = document.getElementById('sinpeRejectMontoReal');
    const notasInput = document.getElementById('sinpeRejectNotasExtra');

    if (estEl) estEl.textContent = currentSinpeRejectData.estudiante_nombre;
    if (montoEl) montoEl.textContent = `₡${currentSinpeRejectData.monto_colones.toLocaleString('es-CR')}`;
    if (compEl) compEl.textContent = currentSinpeRejectData.comprobante;
    if (realInput) realInput.value = '';
    if (notasInput) notasInput.value = '';

    const firstRadio = document.querySelector('input[name="sinpeRejectReason"][value="fondos_no_recibidos"]');
    if (firstRadio) firstRadio.checked = true;

    window.toggleSinpeRejectInputs();

    modal.style.display = 'flex';
  };

  window.cerrarModalRechazoSinpe = function(event) {
    if (event && event.target && event.target !== document.getElementById('modalRechazarSinpe')) {
      return;
    }
    const modal = document.getElementById('modalRechazarSinpe');
    if (modal) modal.style.display = 'none';
    currentSinpeRejectData = null;
  };

  window.toggleSinpeRejectInputs = function() {
    const selected = document.querySelector('input[name="sinpeRejectReason"]:checked');
    const container = document.getElementById('sinpeRejectMontoContainer');
    if (!container || !selected) return;

    if (selected.value === 'monto_no_coincide') {
      container.style.display = 'block';
      window.updateSinpeRejectPreview();
      const input = document.getElementById('sinpeRejectMontoReal');
      if (input) setTimeout(() => input.focus(), 50);
    } else {
      container.style.display = 'none';
    }
  };

  window.updateSinpeRejectPreview = function() {
    const preview = document.getElementById('sinpeRejectMontoPreview');
    const inputReal = document.getElementById('sinpeRejectMontoReal');
    if (!currentSinpeRejectData || !preview || !inputReal) return;

    const solicitado = currentSinpeRejectData.monto_colones || 0;
    const real = Number(inputReal.value || 0);

    preview.textContent = `Se intentaron recargar ₡${solicitado.toLocaleString('es-CR')} pero el SINPE fue de ₡${real.toLocaleString('es-CR')}`;
  };

  window.confirmarRechazoSinpeModal = async function() {
    if (!currentSinpeRejectData) return;

    const selected = document.querySelector('input[name="sinpeRejectReason"]:checked');
    const val = selected ? selected.value : 'fondos_no_recibidos';
    const notasExtra = (document.getElementById('sinpeRejectNotasExtra')?.value || '').trim();
    const solicitado = currentSinpeRejectData.monto_colones || 0;

    let motivoFinal = '';

    if (val === 'fondos_no_recibidos') {
      motivoFinal = 'Fondos no recibidos en cuenta bancaria';
      if (notasExtra) motivoFinal += ` (${notasExtra})`;
    } else if (val === 'monto_no_coincide') {
      const inputReal = document.getElementById('sinpeRejectMontoReal');
      const real = Number(inputReal?.value || 0);
      if (!inputReal?.value || real <= 0) {
        showAppAlert({
          title: 'Monto requerido',
          message: 'Por favor ingresa de cuánto era el monto que figuró en el SINPE recibido.',
          type: 'warning'
        });
        inputReal?.focus();
        return;
      }
      motivoFinal = `Monto no coincide: Se intentaron recargar ₡${solicitado.toLocaleString('es-CR')} pero el SINPE recibido fue de ₡${real.toLocaleString('es-CR')}`;
      if (notasExtra) motivoFinal += ` - ${notasExtra}`;
    } else if (val === 'comprobante_invalido') {
      motivoFinal = 'Comprobante falso, duplicado o ilegible';
      if (notasExtra) motivoFinal += ` (${notasExtra})`;
    } else if (val === 'telefono_no_coincide') {
      motivoFinal = 'Teléfono o destinatario no coincide con la cuenta de la soda';
      if (notasExtra) motivoFinal += ` (${notasExtra})`;
    } else if (val === 'otro') {
      if (!notasExtra) {
        showAppAlert({
          title: 'Detalle requerido',
          message: 'Por favor escribe el motivo específico del rechazo.',
          type: 'warning'
        });
        document.getElementById('sinpeRejectNotasExtra')?.focus();
        return;
      }
      motivoFinal = notasExtra;
    }

    const modal = document.getElementById('modalRechazarSinpe');
    if (modal) modal.style.display = 'none';

    if (typeof currentSinpeRejectData.onConfirm === 'function') {
      const fn = currentSinpeRejectData.onConfirm;
      currentSinpeRejectData = null;
      await fn(motivoFinal);
    }
  };
})();
