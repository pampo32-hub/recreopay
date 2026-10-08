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

  window.abrirModalRechazoSinpe = function({ id, estudiante_nombre, monto_colones, comprobante, onConfirm }) {
    currentSinpeRejectData = {
      id,
      estudiante_nombre: estudiante_nombre || 'Estudiante',
      monto_colones: Number(monto_colones || 0),
      comprobante: comprobante || 'N/A',
      onConfirm
    };

    const modal = document.getElementById('modalRechazarSinpe');
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
