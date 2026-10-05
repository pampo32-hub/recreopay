// RECREOPAY - LÓGICA DE LA TERMINAL DE LA SODA (POS & ESCÁNER)

let posProducts = [];
let posCategories = [];
let posCart = [];
let scannedStudent = null;
let currentTab = 'mostrador';
let sseSource = null;
let videoStream = null;
let isScanningActive = true;
let posMobileActiveView = 'catalog';
let CLOUDFLARE_TUNNEL_URL = 'https://somewhat-ships-looksmart-optical.trycloudflare.com';

function switchPosMobileView(view) {
  posMobileActiveView = view;
  const body = document.body;
  const tabCat = document.getElementById('btnMobileNavCatalog');
  const tabCheck = document.getElementById('btnMobileNavCheckout');
  const floatBar = document.getElementById('posFloatingCheckoutBar');

  if (view === 'checkout') {
    body.classList.remove('pos-mobile-view-catalog');
    body.classList.add('pos-mobile-view-checkout');
    if (tabCat) tabCat.classList.remove('active');
    if (tabCheck) tabCheck.classList.add('active');
    if (floatBar) floatBar.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    body.classList.remove('pos-mobile-view-checkout');
    body.classList.add('pos-mobile-view-catalog');
    if (tabCat) tabCat.classList.add('active');
    if (tabCheck) tabCheck.classList.remove('active');
    updatePosCartUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

window.addEventListener('resize', () => {
  if (window.innerWidth > 900) {
    const floatBar = document.getElementById('posFloatingCheckoutBar');
    if (floatBar) floatBar.style.display = 'none';
  } else {
    updatePosCartUI();
  }
});

function checkPosHttpsEnvironment() {
  const isHttp = window.location.protocol !== 'https:' && 
                 window.location.hostname !== 'localhost' && 
                 window.location.hostname !== '127.0.0.1';
  
  if (isHttp) {
    const banner = document.getElementById('posBannerHttpsWarning');
    if (banner) {
      banner.style.display = 'block';
      const link = document.getElementById('posLinkHttpsRedirect');
      if (link) {
        link.href = CLOUDFLARE_TUNNEL_URL + window.location.pathname;
      }
    }
  }

  fetch('/api/server-info')
    .then(r => r.json())
    .then(info => {
      if (info && info.tunnelUrl) {
        CLOUDFLARE_TUNNEL_URL = info.tunnelUrl;
        const link = document.getElementById('posLinkHttpsRedirect');
        if (link && isHttp) {
          link.href = CLOUDFLARE_TUNNEL_URL + window.location.pathname;
        }
      }
    })
    .catch(() => {});
}

document.addEventListener('DOMContentLoaded', async () => {
  checkPosHttpsEnvironment();
  await loadCatalog();
  await loadPreOrders();
  initCamera();
  initSSE();
});

// Cargar catálogo de productos
async function loadCatalog() {
  try {
    const res = await fetch('/api/productos');
    const data = await res.json();
    posCategories = data.categorias;
    posProducts = data.productos;

    renderPosCategories();
    renderPosProducts(null);
  } catch (err) {
    console.error('Error cargando catálogo:', err);
  }
}

function renderPosCategories() {
  const bar = document.getElementById('posCategoriesBar');
  bar.innerHTML = `
    <button class="pos-tab-btn active" style="padding: 6px 12px; font-size: 0.8rem;" onclick="filterPosCat(null, this)">Todos</button>
    ${posCategories.map(c => `
      <button class="pos-tab-btn" style="padding: 6px 12px; font-size: 0.8rem;" onclick="filterPosCat(${c.id}, this)">
        ${c.icono} ${c.nombre}
      </button>
    `).join('')}
  `;
}

function filterPosCat(catId, btn) {
  document.querySelectorAll('#posCategoriesBar .pos-tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderPosProducts(catId);
}

function renderPosProducts(catId) {
  const grid = document.getElementById('posProductsGrid');
  let list = posProducts;
  if (catId !== null) {
    list = list.filter(p => p.categoria_id === catId);
  }

  grid.innerHTML = list.map(prod => `
    <div class="pos-prod-card" onclick="addToPosCart(${prod.id})">
      <div style="font-size: 2.2rem; text-align: center;">${prod.icono || '🥪'}</div>
      <div>
        <div style="font-size: 0.88rem; font-weight: 800; color: #ffffff; line-height: 1.2;">${prod.nombre}</div>
        ${prod.cumple_mep ? '<span style="font-size: 0.65rem; color: #34d399;">🌿 MEP Saludable</span>' : ''}
      </div>
      <div style="font-size: 1.1rem; font-weight: 900; color: #38bdf8; margin-top: 6px;">
        ₡${prod.precio_colones.toLocaleString('es-CR')}
      </div>
    </div>
  `).join('');
}

// Carrito de mostrador
function addToPosCart(prodId) {
  const prod = posProducts.find(p => p.id === prodId);
  if (!prod) return;

  const existing = posCart.find(i => i.product.id === prodId);
  if (existing) {
    existing.cantidad++;
  } else {
    posCart.push({ product: prod, cantidad: 1 });
  }

  if (window.sounds) window.sounds.playCoin();
  updatePosCartUI();
}

function updatePosCartUI() {
  const list = document.getElementById('posCartList');
  const totalEl = document.getElementById('posCartTotal');
  const totalItems = posCart.reduce((sum, item) => sum + item.cantidad, 0);

  // Actualizar badge móvil
  const mobileBadge = document.getElementById('mobileCartBadge');
  if (mobileBadge) {
    if (totalItems > 0) {
      mobileBadge.textContent = totalItems;
      mobileBadge.style.display = 'inline-block';
    } else {
      mobileBadge.style.display = 'none';
    }
  }

  const floatBar = document.getElementById('posFloatingCheckoutBar');
  const floatText = document.getElementById('posFloatingCartText');
  const floatTotal = document.getElementById('posFloatingCartTotal');

  if (posCart.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #64748b; padding: 20px; font-size: 0.85rem;">Toca productos del menú para cobrar</p>';
    totalEl.textContent = '₡0';
    if (floatBar) floatBar.style.display = 'none';
    return;
  }

  let total = 0;
  list.innerHTML = posCart.map((item, idx) => {
    const subtotal = item.product.precio_colones * item.cantidad;
    total += subtotal;
    return `
      <div class="pos-cart-item">
        <div style="flex: 1; min-width: 0; word-break: break-word;">
          <strong style="color: #f8fafc; font-size: 0.85rem; display: block; line-height: 1.2;">${item.product.icono} ${item.product.nombre}</strong>
          <div style="font-size: 0.74rem; color: #94a3b8; margin-top: 2px;">₡${item.product.precio_colones.toLocaleString('es-CR')} c/u</div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <button onclick="changePosQty(${idx}, -1)" style="width: 26px; height: 26px; background: #334155; color: white; border: none; border-radius: 6px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center;">-</button>
          <span style="font-weight: 800; min-width: 16px; text-align: center; color: #ffffff; font-size: 0.88rem;">${item.cantidad}</span>
          <button onclick="changePosQty(${idx}, 1)" style="width: 26px; height: 26px; background: #334155; color: white; border: none; border-radius: 6px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center;">+</button>
          <span style="font-weight: 900; color: #38bdf8; min-width: 58px; text-align: right; font-size: 0.88rem;">₡${subtotal.toLocaleString('es-CR')}</span>
        </div>
      </div>
    `;
  }).join('');

  totalEl.textContent = `₡${total.toLocaleString('es-CR')}`;

  // Controlar barra flotante en móvil
  if (floatBar && window.innerWidth <= 900) {
    if (totalItems > 0 && posMobileActiveView === 'catalog') {
      floatBar.style.display = 'flex';
      if (floatText) floatText.textContent = `${totalItems} ${totalItems === 1 ? 'ítem' : 'ítems'} en mostrador`;
      if (floatTotal) floatTotal.textContent = `₡${total.toLocaleString('es-CR')}`;
    } else {
      floatBar.style.display = 'none';
    }
  }
}

function changePosQty(idx, delta) {
  posCart[idx].cantidad += delta;
  if (posCart[idx].cantidad <= 0) {
    posCart.splice(idx, 1);
  }
  updatePosCartUI();
}

function clearPosCart() {
  posCart = [];
  updatePosCartUI();
}

// ==========================================
// ESCÁNER Y LECTURA DE QR
// ==========================================

let posFacingMode = 'environment';
let posQrScanningInterval = null;
let posCanvas = null;
let posCanvasCtx = null;
let lastScannedToken = null;
let lastScannedTime = 0;

async function initCamera(isUserAction = false) {
  const video = document.getElementById('scannerVideo');
  const status = document.getElementById('cameraStatus');
  const overlay = document.getElementById('cameraHelpOverlay');
  const helpText = document.getElementById('cameraHelpText');
  const actionContainer = document.getElementById('posCameraActionContainer');
  const retryBtn = document.getElementById('btnRetryPosCamera');
  const flipBtn = document.getElementById('btnFlipPosCamera');

  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }

  const isHttp = window.location.protocol !== 'https:' && 
                 window.location.hostname !== 'localhost' && 
                 window.location.hostname !== '127.0.0.1';

  if (isHttp || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (status) status.textContent = '⚠️ Requiere HTTPS';
    if (overlay) {
      overlay.style.display = 'flex';
      if (helpText) {
        helpText.innerHTML = `
          <div style="font-weight: 800; color: #fca5a5; font-size: 0.85rem; margin-bottom: 4px;">⚠️ Cámara requiere HTTPS</div>
          <span style="font-size: 0.74rem; color: #cbd5e1;">Para acceder a la cámara en vivo en dispositivos remotos o celulares se requiere conexión segura HTTPS. Toca el botón para abrir la terminal segura:</span>
        `;
      }
      if (actionContainer) {
        actionContainer.innerHTML = `
          <button type="button" onclick="window.location.href='${CLOUDFLARE_TUNNEL_URL}' + window.location.pathname" style="padding: 10px 16px; background: #10b981; color: white; border: none; border-radius: 10px; font-weight: 900; font-size: 0.84rem; cursor: pointer; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);">
            🚀 Cambiar a HTTPS Seguro
          </button>
        `;
      }
    }
    return;
  }

  try {
    if (status) status.textContent = 'Conectando cámara...';
    if (overlay) overlay.style.display = 'none';

    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('autoplay', 'true');

    const constraintConfigs = [
      { video: { facingMode: { ideal: posFacingMode }, width: { ideal: 1280 } }, audio: false },
      { video: { facingMode: { ideal: posFacingMode } }, audio: false },
      { video: { facingMode: posFacingMode }, audio: false },
      { video: true, audio: false }
    ];

    let stream = null;
    let lastError = null;

    for (const c of constraintConfigs) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        if (stream) break;
      } catch (errAttempt) {
        lastError = errAttempt;
      }
    }

    if (!stream) {
      throw lastError || new Error('No se pudo acceder a la cámara');
    }

    videoStream = stream;
    video.srcObject = stream;

    await new Promise((resolve) => {
      if (video.readyState >= 1) {
        resolve();
      } else {
        video.onloadedmetadata = () => resolve();
        setTimeout(resolve, 800);
      }
    });

    try {
      await video.play();
    } catch (playErr) {
      console.warn('Reproducción diferida de cámara POS:', playErr);
    }

    if (status) status.textContent = '🟢 Escáner activo';
    if (overlay) overlay.style.display = 'none';
    if (retryBtn) retryBtn.style.display = 'none';
    if (flipBtn) flipBtn.style.display = 'inline-block';

    startUniversalQrDetection(video);
  } catch (err) {
    console.warn('Error accediendo a cámara:', err);
    let userMsg = 'Toca el botón para permitir el uso de la cámara.';
    const errName = err.name || '';

    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      userMsg = '🔒 Permiso denegado: El navegador bloqueó la cámara. Habilita el permiso de cámara en la barra de direcciones.';
    } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
      userMsg = '📷 No se detectó ninguna cámara disponible.';
    } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
      userMsg = '⚠️ La cámara está ocupada por otra app. Ciérrala e intenta de nuevo.';
    }

    if (status) status.textContent = '⚪ Cámara inactiva';
    if (overlay) {
      overlay.style.display = 'flex';
      if (helpText) {
        helpText.innerHTML = `
          <div style="font-weight: 800; color: #fca5a5; font-size: 0.8rem; margin-bottom: 4px;">⚠️ Permiso Requerido</div>
          <span style="font-size: 0.72rem; color: #f1f5f9;">${userMsg}</span>
        `;
      }
      if (actionContainer) {
        actionContainer.innerHTML = `
          <button type="button" onclick="initCamera(true)" style="padding: 8px 16px; background: #0284c7; color: white; border: none; border-radius: 8px; font-weight: 800; font-size: 0.82rem; cursor: pointer; box-shadow: 0 4px 10px rgba(2, 132, 199, 0.4);">
            📷 Tocar para Permitir Cámara
          </button>
        `;
      }
    }
    if (retryBtn) retryBtn.style.display = 'inline-block';
  }
}

function handlePosQrPhoto(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const status = document.getElementById('cameraStatus');
  if (status) status.textContent = 'Analizando foto...';

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const maxDim = 1200;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);

      if (window.jsQR) {
        const code = window.jsQR(imgData.data, w, h, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && code.data) {
          onQrCodeDetected(code.data);
          if (status) status.textContent = '🟢 QR Reconocido';
          return;
        }
      }
      if (status) status.textContent = '❌ No detectado';
      alert('⚠️ No se detectó un código QR válido en la foto tomada.');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function flipPosCamera() {
  posFacingMode = posFacingMode === 'environment' ? 'user' : 'environment';
  initCamera(true);
}

function startUniversalQrDetection(video) {
  if (!posCanvas) {
    posCanvas = document.createElement('canvas');
    posCanvasCtx = posCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (posQrScanningInterval) {
    cancelAnimationFrame(posQrScanningInterval);
  }

  function scanFrame() {
    if (isScanningActive && video.readyState === video.HAVE_ENOUGH_DATA) {
      posCanvas.width = video.videoWidth;
      posCanvas.height = video.videoHeight;
      posCanvasCtx.drawImage(video, 0, 0, posCanvas.width, posCanvas.height);
      const imageData = posCanvasCtx.getImageData(0, 0, posCanvas.width, posCanvas.height);

      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        if (code && code.data) {
          const now = Date.now();
          // Evitar lecturas duplicadas en menos de 2 segundos
          if (code.data !== lastScannedToken || (now - lastScannedTime) > 2000) {
            lastScannedToken = code.data;
            lastScannedTime = now;
            onQrCodeDetected(code.data);
          }
        }
      }
    }
    posQrScanningInterval = requestAnimationFrame(scanFrame);
  }

  posQrScanningInterval = requestAnimationFrame(scanFrame);
}

function simulateScan(qrToken) {
  onQrCodeDetected(qrToken);
}

async function onQrCodeDetected(token) {
  if (window.sounds) window.sounds.playScanChirp();

  // Si estamos en la pestaña de fila rápida de pre-órdenes, despachamos de inmediato
  if (currentTab === 'preordenes') {
    await dispatchPreOrderExpress(token);
    return;
  }

  // Si estamos en mostrador, identificamos al estudiante
  try {
    const res = await fetch(`/api/estudiantes/qr/${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    scannedStudent = data;
    renderScannedStudent();

    // Si tiene pre-órdenes listas, alertar a la cajera
    if (data.preordenes_pendientes && data.preordenes_pendientes.length > 0) {
      if (confirm(`🔔 ¡Atención! ${data.nombre_completo} tiene ${data.preordenes_pendientes.length} pre-orden lista para retirar. ¿Deseas verla y entregarla ahora?`)) {
        switchPosTab('preordenes');
      }
    }
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`QR no reconocido: ${err.message}`);
  }
}

function renderScannedStudent() {
  if (!scannedStudent) {
    document.getElementById('studentScannedCard').style.display = 'none';
    document.getElementById('scannedAllergyAlert').style.display = 'none';
    return;
  }

  document.getElementById('scannedAvatar').src = scannedStudent.foto_url;
  
  const btnCobrar = document.getElementById('btnCobrarPos');
  if (scannedStudent.tarjeta_bloqueada) {
    document.getElementById('scannedName').innerHTML = `${scannedStudent.nombre_completo} <span style="font-size: 0.72rem; color: #fee2e2; background: #dc2626; padding: 2px 7px; border-radius: 6px; font-weight: 900; margin-left: 6px;">⛔ TARJETA SUSPENDIDA</span>`;
    if (btnCobrar) {
      btnCobrar.disabled = true;
      btnCobrar.textContent = '⛔ Tarjeta Suspendida';
      btnCobrar.style.background = '#64748b';
    }
  } else {
    document.getElementById('scannedName').textContent = scannedStudent.nombre_completo;
    if (btnCobrar) {
      btnCobrar.disabled = false;
      btnCobrar.textContent = 'Cobrar y Despachar ⚡';
      btnCobrar.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    }
  }

  document.getElementById('scannedGrade').textContent = `${scannedStudent.grado} • Sección ${scannedStudent.seccion} • Cód: ${scannedStudent.codigo_estudiante}`;
  document.getElementById('scannedBalance').textContent = `₡${scannedStudent.saldo_colones.toLocaleString('es-CR')}`;
  document.getElementById('scannedAvailable').textContent = `₡${scannedStudent.disponible_hoy.toLocaleString('es-CR')}`;
  document.getElementById('studentScannedCard').style.display = 'flex';

  // Alerta médica en mostrador
  const alertBox = document.getElementById('scannedAllergyAlert');
  if (scannedStudent.alergias && scannedStudent.alergias !== 'Ninguna' && scannedStudent.alergias !== 'Ninguna conocida') {
    alertBox.style.display = 'block';
    document.getElementById('scannedAllergyText').textContent = scannedStudent.alergias;
  } else {
    alertBox.style.display = 'none';
  }

  // En pantallas móviles, mostrar la vista de caja automáticamente
  if (window.innerWidth <= 900) {
    switchPosMobileView('checkout');
  }
}

function clearScannedStudent() {
  scannedStudent = null;
  renderScannedStudent();
}

// Ejecutar cobro en mostrador
async function executePosDebit() {
  if (!scannedStudent) {
    if (window.sounds) window.sounds.playError();
    return alert('⚠️ Primero escanea el carné o celular del estudiante (puedes usar los botones de prueba rápida en la cámara).');
  }

  if (scannedStudent.tarjeta_bloqueada) {
    if (window.sounds) window.sounds.playError();
    return alert(`⛔ ¡TARJETA SUSPENDIDA!\nLa tarjeta de ${scannedStudent.nombre_completo} ha sido bloqueada por la administración de la soda. No se pueden procesar cobros.`);
  }

  if (posCart.length === 0) {
    if (window.sounds) window.sounds.playError();
    return alert('⚠️ Selecciona al menos un producto en el mostrador para cobrar.');
  }

  const items = posCart.map(item => ({
    producto_id: item.product.id,
    cantidad: item.cantidad
  }));

  const btn = document.getElementById('btnCobrarPos');
  btn.disabled = true;
  btn.textContent = 'Procesando débito...';

  try {
    const res = await fetch('/api/ordenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estudiante_id: scannedStudent.id,
        tipo_orden: 'mostrador',
        momento_entrega: 'inmediato',
        items
      })
    });

    const data = await res.json();
    if (!res.ok) {
      if (window.sounds) window.sounds.playError();
      throw new Error(data.error);
    }

    if (window.sounds) window.sounds.playSuccess();

    alert(`✅ ¡COBRO EXITOSO!\nTicket: ${data.codigo_orden}\nEstudiante: ${scannedStudent.nombre_completo}\nMonto: ₡${data.total_colones.toLocaleString('es-CR')}\nNuevo Saldo: ₡${data.financiero.estudiante.saldo_nuevo.toLocaleString('es-CR')}`);

    // Limpiar caja y refrescar
    clearPosCart();
    clearScannedStudent();

    // En móviles, volver a la vista del catálogo para la siguiente venta
    if (window.innerWidth <= 900) {
      switchPosMobileView('catalog');
    }
  } catch (err) {
    alert(`❌ Fallo en la transacción: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>📱</span> COBRAR CON QR DE ALUMNO';
  }
}

// ==========================================
// FILA RÁPIDA DE PRE-ÓRDENES
// ==========================================

function switchPosTab(tab) {
  currentTab = tab;
  document.getElementById('tabBtnMostrador').classList.toggle('active', tab === 'mostrador');
  document.getElementById('tabBtnPreordenes').classList.toggle('active', tab === 'preordenes');

  document.getElementById('viewPosMostrador').style.display = tab === 'mostrador' ? 'block' : 'none';
  document.getElementById('viewPosPreordenes').style.display = tab === 'preordenes' ? 'block' : 'none';

  if (tab === 'preordenes') {
    loadPreOrders();
  }
}

async function loadPreOrders() {
  try {
    const res = await fetch('/api/ordenes?tipo=preorden');
    const orders = await res.json();

    const pendingCount = orders.filter(o => o.estado !== 'entregado' && o.estado !== 'cancelado').length;
    document.getElementById('badgePreordenesCount').textContent = pendingCount;

    const list = document.getElementById('preOrdersList');
    if (orders.length === 0) {
      list.innerHTML = '<p style="text-align: center; color: #64748b; padding: 30px;">No hay pre-órdenes registradas para hoy.</p>';
      return;
    }

    list.innerHTML = orders.map(ord => {
      const hora = new Date(ord.creado_en).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
      const itemsList = ord.items.map(i => `${i.cantidad}x ${i.icono || '🥪'} ${i.nombre}`).join(', ');

      return `
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 14px; display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; gap: 12px; align-items: center;">
            <img src="${ord.foto_url}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid #38bdf8;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="color: #ffffff; font-size: 0.95rem;">${ord.estudiante_nombre}</strong>
                <span style="font-size: 0.75rem; color: #94a3b8;">${ord.grado} - ${ord.seccion}</span>
                <span class="status-pill status-${ord.estado}">${ord.estado}</span>
              </div>
              <div style="font-size: 0.8rem; color: #38bdf8; margin: 2px 0;">📦 ${itemsList}</div>
              <div style="font-size: 0.72rem; color: #94a3b8;">Ticket: ${ord.codigo_orden} • Pedido a las ${hora} • Total: ₡${ord.total_colones.toLocaleString('es-CR')}</div>
            </div>
          </div>

          <div style="display: flex; gap: 8px;">
            ${ord.estado === 'pendiente' ? `
              <button onclick="updateOrderStatus(${ord.id}, 'en_preparacion')" style="padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">
                👨‍🍳 Preparar
              </button>
            ` : ''}
            ${ord.estado === 'en_preparacion' ? `
              <button onclick="updateOrderStatus(${ord.id}, 'listo')" style="padding: 6px 12px; background: #10b981; color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">
                🛍️ Listo en Bolsa
              </button>
            ` : ''}
            ${ord.estado === 'listo' ? `
              <button onclick="updateOrderStatus(${ord.id}, 'entregado')" style="padding: 6px 14px; background: #059669; color: white; border: none; border-radius: 8px; font-weight: 800; cursor: pointer;">
                ✅ Entregar
              </button>
            ` : ''}
            ${ord.estado === 'entregado' ? `
              <span style="font-size: 0.78rem; color: #34d399; font-weight: 800;">✓ Entregado</span>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error cargando pre-órdenes:', err);
  }
}

async function updateOrderStatus(orderId, nuevoEstado) {
  try {
    const res = await fetch(`/api/ordenes/${orderId}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nuevoEstado })
    });
    if (!res.ok) throw new Error('Error actualizando orden');
    if (window.sounds) window.sounds.playCoin();
    loadPreOrders();
  } catch (e) {
    alert(e.message);
  }
}

// Despacho Express en 3 segundos mediante escaneo de QR
async function dispatchPreOrderExpress(qrToken) {
  try {
    const res = await fetch('/api/ordenes/despachar-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr_token: qrToken })
    });

    const data = await res.json();
    if (!res.ok) {
      if (window.sounds) window.sounds.playError();
      throw new Error(data.error);
    }

    if (window.sounds) window.sounds.playSuccess();

    alert(`🎉 ¡ENTREGA EXPRESS EXITOSA!\n${data.mensaje}\nAlumno: ${data.estudiante.nombre_completo}\nGrado: ${data.estudiante.grado}\nProductos a entregar:\n${data.orden.items.map(i => `• ${i.cantidad}x ${i.nombre}`).join('\n')}`);

    loadPreOrders();
  } catch (err) {
    alert(err.message);
  }
}

// ==========================================
// SSE (SERVER-SENT EVENTS EN TIEMPO REAL)
// ==========================================

function initSSE() {
  sseSource = new EventSource('/api/events');

  sseSource.addEventListener('nueva_orden', (e) => {
    const orden = JSON.parse(e.data);
    if (window.sounds) window.sounds.playSuccess();
    // Notificación sonora y visual
    loadPreOrders();
  });

  sseSource.addEventListener('orden_actualizada', () => {
    loadPreOrders();
  });
}
