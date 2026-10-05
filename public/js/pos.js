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
  // La cámara se activa bajo demanda al cobrar o identificar, NO al entrar
  initSSE();
  initPistolScanner();
  initQuickProductEvents();
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
        ${c.icono || '🍽️'} ${c.nombre}
      </button>
    `).join('')}
  `;
}

let currentPosCatId = null;

function filterPosCat(catId, btn) {
  currentPosCatId = catId;
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

  grid.innerHTML = list.map(prod => {
    const isOutOfStock = prod.disponible === 0 || (prod.control_stock === 1 && prod.stock <= 0);

    return `
      <div class="pos-prod-card ${isOutOfStock ? 'out-of-stock-pos' : ''}" 
           style="${isOutOfStock ? 'opacity: 0.45; filter: grayscale(0.85); cursor: not-allowed; position: relative; border-color: #ef4444;' : ''}"
           onclick="${isOutOfStock ? `alert('El producto \\'${prod.nombre.replace(/'/g, "\\'")}\\' se encuentra bloqueado o agotado.')` : `addToPosCart(${prod.id})`}">
        ${isOutOfStock ? '<div style="position: absolute; top: 8px; right: 8px; background: #dc2626; color: #ffffff; font-size: 0.65rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; z-index: 2; letter-spacing: 0.5px;">BLOQUEADO</div>' : ''}
        <div style="font-size: 2.2rem; text-align: center;">${prod.icono || '🥪'}</div>
        <div>
          <div style="font-size: 0.88rem; font-weight: 800; color: #ffffff; line-height: 1.2;">${prod.nombre}</div>
          ${prod.cumple_mep ? '<span style="font-size: 0.65rem; color: #34d399;">🌿 MEP Saludable</span>' : ''}
          ${isOutOfStock ? '<span style="font-size: 0.65rem; color: #f87171; display: block; margin-top: 2px; font-weight: 700;">No disponible</span>' : ''}
        </div>
        <div style="font-size: 1.1rem; font-weight: 900; color: ${isOutOfStock ? '#94a3b8' : '#38bdf8'}; margin-top: 6px;">
          ₡${prod.precio_colones.toLocaleString('es-CR')}
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================
// NUEVO PRODUCTO RÁPIDO EN CALIENTE (POS)
// ==========================================

function openQuickProductModal() {
  const modal = document.getElementById('modalProductoRapido');
  if (!modal) return;
  modal.style.display = 'flex';
  const inputNom = document.getElementById('inputQuickProdNombre');
  const inputPre = document.getElementById('inputQuickProdPrecio');
  if (inputNom) {
    inputNom.value = '';
    setTimeout(() => inputNom.focus(), 80);
  }
  if (inputPre) inputPre.value = '';
}

function closeQuickProductModal() {
  const modal = document.getElementById('modalProductoRapido');
  if (modal) modal.style.display = 'none';
}

function initQuickProductEvents() {
  const inputNom = document.getElementById('inputQuickProdNombre');
  const inputPre = document.getElementById('inputQuickProdPrecio');

  if (inputNom) {
    inputNom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (inputPre) inputPre.focus();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modalProductoRapido');
      if (modal && modal.style.display !== 'none') {
        closeQuickProductModal();
      }
    }
  });
}

async function saveQuickProduct(e) {
  if (e) e.preventDefault();
  const inputNom = document.getElementById('inputQuickProdNombre');
  const inputPre = document.getElementById('inputQuickProdPrecio');
  const btn = document.getElementById('btnSubmitQuickProd');

  const nombre = inputNom ? inputNom.value.trim() : '';
  const precio = inputPre ? parseInt(inputPre.value, 10) : 0;

  if (!nombre) {
    alert('Ingresa el nombre del producto');
    if (inputNom) inputNom.focus();
    return;
  }
  if (!precio || isNaN(precio) || precio <= 0) {
    alert('Ingresa un precio válido en colones');
    if (inputPre) inputPre.focus();
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Guardando...';
  }

  try {
    const res = await fetch('/api/productos/rapido', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, precio_colones: precio })
    });
    const data = await res.json();

    if (!res.ok || !data.success || !data.producto) {
      throw new Error(data.error || 'No se pudo guardar el producto');
    }

    const nuevoProd = data.producto;

    // Agregar al catálogo en memoria de la terminal de primero
    const exists = posProducts.find(p => p.id === nuevoProd.id);
    if (!exists) {
      posProducts.unshift(nuevoProd);
    }

    // Re-renderizar productos del mostrador
    renderPosProducts(currentPosCatId);

    // Agregar de inmediato 1 unidad al carrito de cobro
    addToPosCart(nuevoProd.id);

    // Cerrar modal
    closeQuickProductModal();

    if (window.sounds) window.sounds.playCoin();
  } catch (err) {
    alert('Error al registrar producto: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>💾</span> Guardar y Cobrar ➔';
    }
  }
}

// Carrito de mostrador
function addToPosCart(prodId) {
  const prod = posProducts.find(p => p.id === prodId);
  if (!prod) return;

  if (prod.disponible === 0 || (prod.control_stock === 1 && prod.stock <= 0)) {
    alert(`El producto "${prod.nombre}" no está disponible o se encuentra agotado.`);
    return;
  }

  const existing = posCart.find(i => i.product.id === prodId);
  const currentInCart = existing ? existing.cantidad : 0;
  if (prod.control_stock === 1 && (currentInCart + 1) > prod.stock) {
    alert(`Solo quedan ${prod.stock} unidad(es) de "${prod.nombre}" en inventario.`);
    return;
  }

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
          <strong style="color: #f8fafc; font-size: 0.85rem; display: block; line-height: 1.2;">${item.product.icono ? `${item.product.icono} ` : ''}${item.product.nombre}</strong>
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
// ==========================================
// CÁMARA Y ESCÁNER QR BAJO DEMANDA (EN MODAL)
// ==========================================

let posModalMode = 'cobro'; // 'cobro' | 'identificar' | 'preorden'
let modalVideoStream = null;
let modalQrScanningInterval = null;
let isModalScanningActive = false;
let modalCanvas = null;
let modalCanvasCtx = null;
let lastScannedToken = null;
let lastScannedTime = 0;

async function startModalCamera(isUserAction = false) {
  const video = document.getElementById('modalScannerVideo');
  const badge = document.getElementById('modalCameraStatusBadge');
  const overlay = document.getElementById('modalCameraOverlay');
  const helpText = document.getElementById('modalCameraHelpText');

  stopModalCamera();

  if (!video) return;

  const isHttp = window.location.protocol !== 'https:' && 
                 window.location.hostname !== 'localhost' && 
                 window.location.hostname !== '127.0.0.1';

  if (isHttp || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (badge) badge.textContent = '⚠️ Requiere HTTPS';
    if (overlay) {
      overlay.style.display = 'flex';
      if (helpText) {
        helpText.innerHTML = `
          <div style="font-weight: 800; color: #fca5a5; font-size: 0.85rem; margin-bottom: 4px;">⚠️ Cámara requiere HTTPS</div>
          <span style="font-size: 0.74rem; color: #cbd5e1;">Para acceder a la cámara en vivo en dispositivos remotos o celulares se requiere conexión segura HTTPS. Toca el botón:</span>
          <button type="button" onclick="window.location.href='${CLOUDFLARE_TUNNEL_URL}' + window.location.pathname" style="margin-top: 8px; padding: 8px 14px; background: #10b981; color: white; border: none; border-radius: 8px; font-weight: 800; font-size: 0.8rem; cursor: pointer;">
            🚀 Cambiar a HTTPS Seguro
          </button>
        `;
      }
    }
    return;
  }

  try {
    if (badge) {
      badge.textContent = '📷 Conectando cámara...';
      badge.style.background = 'rgba(15, 23, 42, 0.92)';
      badge.style.borderColor = '#0284c7';
      badge.style.color = '#38bdf8';
    }
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

    modalVideoStream = stream;
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

    if (badge) badge.textContent = '📷 Apunta el carné a la cámara o dispara pistola';
    if (overlay) overlay.style.display = 'none';

    startModalQrDetection(video);
  } catch (err) {
    console.warn('Error accediendo a cámara modal:', err);
    let userMsg = 'Toca el botón para permitir el uso de la cámara.';
    const errName = err.name || '';

    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      userMsg = '🔒 Permiso denegado: Habilita el permiso de cámara en la barra de direcciones del navegador.';
    } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
      userMsg = '📷 No se detectó ninguna cámara disponible en este dispositivo.';
    } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
      userMsg = '⚠️ La cámara está ocupada por otra app. Ciérrala e intenta de nuevo.';
    }

    if (badge) badge.textContent = '⚪ Cámara inactiva';
    if (overlay) {
      overlay.style.display = 'flex';
      if (helpText) {
        helpText.innerHTML = `
          <div style="font-weight: 800; color: #fca5a5; font-size: 0.8rem; margin-bottom: 4px;">⚠️ Permiso Requerido</div>
          <span style="font-size: 0.72rem; color: #f1f5f9;">${userMsg}</span>
        `;
      }
    }
  }
}

function stopModalCamera() {
  isModalScanningActive = false;
  if (modalQrScanningInterval) {
    cancelAnimationFrame(modalQrScanningInterval);
    modalQrScanningInterval = null;
  }
  if (modalVideoStream) {
    modalVideoStream.getTracks().forEach(t => t.stop());
    modalVideoStream = null;
  }
  const video = document.getElementById('modalScannerVideo');
  if (video) {
    video.srcObject = null;
  }
}

function startModalQrDetection(video) {
  if (!modalCanvas) {
    modalCanvas = document.createElement('canvas');
    modalCanvasCtx = modalCanvas.getContext('2d', { willReadFrequently: true });
  }

  isModalScanningActive = true;
  if (modalQrScanningInterval) {
    cancelAnimationFrame(modalQrScanningInterval);
  }

  function scanFrame() {
    if (isModalScanningActive && video && video.readyState === video.HAVE_ENOUGH_DATA) {
      modalCanvas.width = video.videoWidth;
      modalCanvas.height = video.videoHeight;
      modalCanvasCtx.drawImage(video, 0, 0, modalCanvas.width, modalCanvas.height);
      const imageData = modalCanvasCtx.getImageData(0, 0, modalCanvas.width, modalCanvas.height);

      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        if (code && code.data) {
          const now = Date.now();
          if (code.data !== lastScannedToken || (now - lastScannedTime) > 2000) {
            lastScannedToken = code.data;
            lastScannedTime = now;
            onQrCodeDetected(code.data);
            return; // Detener loop de escaneo inmediatamente
          }
        }
      }
    }
    if (isModalScanningActive) {
      modalQrScanningInterval = requestAnimationFrame(scanFrame);
    }
  }

  modalQrScanningInterval = requestAnimationFrame(scanFrame);
}

function simulateScan(qrToken) {
  onQrCodeDetected(qrToken);
}

async function onQrCodeDetected(token) {
  // 1. APAGAR LA CÁMARA DE INMEDIATO - DEJA DE GRABAR
  stopModalCamera();

  // 2. Indicador sonoro y visual de lectura correcta
  if (window.sounds) window.sounds.playScanChirp();

  const badge = document.getElementById('modalCameraStatusBadge');
  if (badge) {
    badge.textContent = '✅ ¡QR Detectado Exitosamente!';
    badge.style.background = '#065f46';
    badge.style.borderColor = '#10b981';
    badge.style.color = '#34d399';
  }

  // Ocultar caja de cámara para que sea evidente que ya terminó de grabar
  const camBox = document.getElementById('modalCameraContainer');
  if (camBox) {
    camBox.style.display = 'none';
  }

  // 3. Procesar según el modo en el que se abrió el modal
  if (posModalMode === 'preorden') {
    await dispatchPreOrderExpress(token);
    closePistolaModal();
    return;
  }

  if (posModalMode === 'identificar' || posCart.length === 0) {
    try {
      const res = await fetch(`/api/estudiantes/qr/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      scannedStudent = data;
      renderScannedStudent();
      if (window.sounds) window.sounds.playSuccess();
      closePistolaModal();

      if (data.preordenes_pendientes && data.preordenes_pendientes.length > 0) {
        if (confirm(`🔔 ¡Atención! ${data.nombre_completo} tiene ${data.preordenes_pendientes.length} pre-orden lista para retirar. ¿Deseas verla y entregarla ahora?`)) {
          switchPosTab('preordenes');
        }
      }
    } catch (err) {
      if (window.sounds) window.sounds.playError();
      alert(`⚠️ Estudiante no reconocido: ${err.message}`);
      resetPistolaModalWaiting();
    }
    return;
  }

  // Modo cobro (posCart.length > 0): Ejecutar cobro inmediato
  await handlePistolBarcodeScan(token);
}

function openStudentIdModal() {
  openPistolaModal('identificar');
}

function openPreOrderScanModal() {
  openPistolaModal('preorden');
}

function renderScannedStudent() {
  const placeholder = document.getElementById('posNoStudentPlaceholder');
  if (!scannedStudent) {
    if (placeholder) placeholder.style.display = 'block';
    document.getElementById('studentScannedCard').style.display = 'none';
    document.getElementById('scannedAllergyAlert').style.display = 'none';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';

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
      btnCobrar.innerHTML = `<span>🔫</span> COBRAR A ${scannedStudent.nombre_completo.split(' ')[0].toUpperCase()} ➔`;
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
  const btnCobrar = document.getElementById('btnCobrarPos');
  if (btnCobrar) {
    btnCobrar.disabled = false;
    btnCobrar.innerHTML = '<span>🔫</span> COBRAR CON PISTOLA QR';
    btnCobrar.style.background = 'linear-gradient(135deg, #0284c7, #0369a1)';
  }
}

// ==========================================
// PISTOLA LECTORA DE QR (USB/BLUETOOTH) Y COBRO RÁPIDO
// ==========================================

let barcodeBuffer = '';
let barcodeLastTime = 0;
let pistolaAutoCloseTimer = null;

function initPistolScanner() {
  // Listener global para capturar ráfagas rápidas de pistola USB/Bluetooth
  window.addEventListener('keydown', (e) => {
    // Si presiona Escape, cerrar modal de cobro si está abierto
    if (e.key === 'Escape') {
      closePistolaModal();
      return;
    }

    // Si presiona Enter y el modal está en pantalla de éxito, cerrarlo para el siguiente
    const modalSuccess = document.getElementById('pistolaStateSuccess');
    if (e.key === 'Enter' && modalSuccess && modalSuccess.style.display !== 'none') {
      e.preventDefault();
      closePistolaModal();
      return;
    }

    const now = Date.now();
    // Si pasaron más de 80ms entre teclas, no es pistola, es un humano escribiendo
    if (now - barcodeLastTime > 80 && barcodeBuffer.length > 0) {
      barcodeBuffer = '';
    }
    barcodeLastTime = now;

    if (e.key === 'Enter') {
      if (barcodeBuffer.trim().length >= 3) {
        e.preventDefault();
        const code = barcodeBuffer.trim();
        barcodeBuffer = '';
        handlePistolBarcodeScan(code);
        return;
      }
    } else if (e.key.length === 1) {
      barcodeBuffer += e.key;
    }
  });

  // Listener para el input de texto del modal
  const inputScan = document.getElementById('inputPistolaDirectScan');
  if (inputScan) {
    inputScan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = inputScan.value.trim();
        if (val.length >= 3) {
          inputScan.value = '';
          handlePistolBarcodeScan(val);
        }
      }
    });
  }
}

function openPistolaModal(mode = 'cobro') {
  posModalMode = mode;

  if (posModalMode === 'cobro' && posCart.length === 0) {
    if (window.sounds) window.sounds.playError();
    alert('⚠️ Selecciona al menos un producto en el mostrador para cobrar.');
    return;
  }

  const modal = document.getElementById('modalPistolaCobro');
  if (!modal) return;

  const totalContainer = document.getElementById('pistolaTotalContainer');
  const title = document.getElementById('pistolaModalTitle');
  const icon = document.getElementById('pistolaModalIcon');

  if (posModalMode === 'cobro') {
    const total = posCart.reduce((sum, item) => sum + (item.product.precio_colones * item.cantidad), 0);
    const totalItems = posCart.reduce((sum, item) => sum + item.cantidad, 0);

    if (totalContainer) totalContainer.style.display = 'block';
    document.getElementById('pistolaModalTotal').textContent = `₡${total.toLocaleString('es-CR')}`;
    document.getElementById('pistolaModalItemCount').textContent = `${totalItems} ${totalItems === 1 ? 'producto' : 'productos'} en mostrador`;
    if (title) title.textContent = 'Cobro con QR / Pistola';
    if (icon) icon.textContent = '💳';
  } else if (posModalMode === 'identificar') {
    if (totalContainer) totalContainer.style.display = 'none';
    if (title) title.textContent = 'Identificar Alumno por QR';
    if (icon) icon.textContent = '👤';
  } else if (posModalMode === 'preorden') {
    if (totalContainer) totalContainer.style.display = 'none';
    if (title) title.textContent = 'Despachar Pre-Orden con QR';
    if (icon) icon.textContent = '📦';
  }

  resetPistolaModalWaiting();
  modal.style.display = 'flex';

  // Mostrar el contenedor de cámara e inicializar stream bajo demanda
  const camBox = document.getElementById('modalCameraContainer');
  if (camBox) camBox.style.display = 'flex';

  startModalCamera();

  setTimeout(() => {
    const input = document.getElementById('inputPistolaDirectScan');
    if (input) input.focus();
  }, 100);

  if (window.sounds) window.sounds.playTap();
}

function closePistolaModal(e) {
  if (e && e.target && e.target.id !== 'modalPistolaCobro') return;
  if (pistolaAutoCloseTimer) {
    clearTimeout(pistolaAutoCloseTimer);
    pistolaAutoCloseTimer = null;
  }
  // SIEMPRE apagar la cámara de inmediato al salir del modal
  stopModalCamera();

  const modal = document.getElementById('modalPistolaCobro');
  if (modal) modal.style.display = 'none';
}

function resetPistolaModalWaiting() {
  if (pistolaAutoCloseTimer) {
    clearTimeout(pistolaAutoCloseTimer);
    pistolaAutoCloseTimer = null;
  }
  document.getElementById('pistolaStateWaiting').style.display = 'block';
  document.getElementById('pistolaStateProcessing').style.display = 'none';
  document.getElementById('pistolaStateSuccess').style.display = 'none';
  document.getElementById('pistolaStateError').style.display = 'none';

  const camBox = document.getElementById('modalCameraContainer');
  if (camBox) camBox.style.display = 'flex';

  const badge = document.getElementById('modalCameraStatusBadge');
  if (badge) {
    badge.textContent = '📷 Apunta el carné a la cámara o dispara pistola';
    badge.style.background = 'rgba(15, 23, 42, 0.92)';
    badge.style.borderColor = '#0284c7';
    badge.style.color = '#38bdf8';
  }

  const input = document.getElementById('inputPistolaDirectScan');
  if (input) {
    input.value = '';
    input.focus();
  }
}

async function handlePistolBarcodeScan(rawToken) {
  const token = String(rawToken).trim();
  if (!token) return;

  // Garantizar que la cámara se apague de inmediato
  stopModalCamera();

  if (window.sounds) window.sounds.playScanChirp();

  // Si no hay productos en el carrito, identificar al alumno para mostrador
  if (posCart.length === 0) {
    try {
      const res = await fetch(`/api/estudiantes/qr/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      scannedStudent = data;
      renderScannedStudent();
      if (window.sounds) window.sounds.playSuccess();
      closePistolaModal();
    } catch (err) {
      if (window.sounds) window.sounds.playError();
      alert(`⚠️ Estudiante no reconocido: ${err.message}`);
    }
    return;
  }

  // SI HAY PRODUCTOS EN EL CARRITO: EJECUTAR COBRO INMEDIATO CON PISTOLA
  const modal = document.getElementById('modalPistolaCobro');
  if (modal && modal.style.display === 'none') {
    modal.style.display = 'flex';
  }

  // Mostrar estado de procesamiento
  document.getElementById('pistolaStateWaiting').style.display = 'none';
  document.getElementById('pistolaStateError').style.display = 'none';
  document.getElementById('pistolaStateSuccess').style.display = 'none';
  document.getElementById('pistolaStateProcessing').style.display = 'block';
  document.getElementById('pistolaProcessingName').textContent = 'Identificando estudiante y validando monedero...';

  try {
    // 1. Buscar estudiante por token o código
    const resEst = await fetch(`/api/estudiantes/qr/${encodeURIComponent(token)}`);
    const student = await resEst.json();
    if (!resEst.ok) throw new Error(student.error || 'Carné escolar no encontrado');

    document.getElementById('pistolaProcessingName').textContent = `Verificando saldo para ${student.nombre_completo}...`;

    // 2. Validar si la tarjeta está suspendida
    if (student.tarjeta_bloqueada) {
      throw new Error(`⛔ TARJETA SUSPENDIDA: La tarjeta de ${student.nombre_completo} ha sido bloqueada por la administración de la soda.`);
    }

    // 3. Validar saldo disponible y límite diario
    const totalCompra = posCart.reduce((sum, item) => sum + (item.product.precio_colones * item.cantidad), 0);
    
    if (student.saldo_colones < totalCompra) {
      throw new Error(`⚠️ SALDO INSUFICIENTE: ${student.nombre_completo} tiene ₡${student.saldo_colones.toLocaleString('es-CR')} de saldo y la compra es de ₡${totalCompra.toLocaleString('es-CR')}.`);
    }

    if (student.disponible_hoy < totalCompra) {
      throw new Error(`⚠️ SUPERA LÍMITE DIARIO: Le quedan ₡${student.disponible_hoy.toLocaleString('es-CR')} disponibles hoy de su límite diario asignado.`);
    }

    // 4. Procesar cobro en servidor
    const items = posCart.map(item => ({
      producto_id: item.product.id,
      cantidad: item.cantidad
    }));

    const resCobro = await fetch('/api/ordenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estudiante_id: student.id,
        tipo_orden: 'mostrador',
        momento_entrega: 'inmediato',
        items
      })
    });

    const dataCobro = await resCobro.json();
    if (!resCobro.ok) throw new Error(dataCobro.error || 'Error al procesar el débito');

    // 5. Éxito: Mostrar pantalla de confirmación
    document.getElementById('pistolaStateProcessing').style.display = 'none';
    document.getElementById('pistolaStateSuccess').style.display = 'block';

    document.getElementById('pistolaSuccessStudent').textContent = student.nombre_completo;
    document.getElementById('pistolaSuccessTicket').textContent = dataCobro.codigo_orden;
    document.getElementById('pistolaSuccessAmount').textContent = `₡${totalCompra.toLocaleString('es-CR')}`;
    const nuevoSaldo = (dataCobro.financiero && dataCobro.financiero.estudiante) 
      ? dataCobro.financiero.estudiante.saldo_nuevo 
      : (student.saldo_colones - totalCompra);
    document.getElementById('pistolaSuccessBalance').textContent = `₡${nuevoSaldo.toLocaleString('es-CR')}`;

    if (window.sounds) {
      window.sounds.playSuccess();
      window.sounds.playCoin();
    }

    // Limpiar carrito de mostrador
    clearPosCart();
    clearScannedStudent();

    // Auto-cerrar el modal en 2.5 segundos para quedar listo para el siguiente alumno
    pistolaAutoCloseTimer = setTimeout(() => {
      closePistolaModal();
    }, 2500);

  } catch (err) {
    if (window.sounds) window.sounds.playError();
    document.getElementById('pistolaStateProcessing').style.display = 'none';
    document.getElementById('pistolaStateError').style.display = 'block';
    document.getElementById('pistolaErrorTitle').textContent = 'No se pudo realizar el cobro';
    document.getElementById('pistolaErrorDesc').textContent = err.message;
  }
}

// Ejecutar cobro en mostrador (desde botón principal)
async function executePosDebit() {
  if (posCart.length === 0) {
    if (window.sounds) window.sounds.playError();
    alert('⚠️ Selecciona al menos un producto en el mostrador para cobrar.');
    return;
  }

  // Si ya tenemos un estudiante identificado previamente, cobramos directamente
  if (scannedStudent) {
    await handlePistolBarcodeScan(scannedStudent.qr_token || scannedStudent.codigo_estudiante);
    return;
  }

  // Si no hay estudiante previo, abrir modal esperando el disparo de la pistola QR
  openPistolaModal();
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

    if (!Array.isArray(orders)) {
      console.warn('Respuesta no válida al cargar pre-órdenes:', orders);
      return;
    }

    const pendingCount = orders.filter(o => o.estado !== 'entregado' && o.estado !== 'cancelado').length;
    document.getElementById('badgePreordenesCount').textContent = pendingCount;

    const list = document.getElementById('preOrdersList');
    if (orders.length === 0) {
      list.innerHTML = '<p style="text-align: center; color: #64748b; padding: 30px;">No hay pre-órdenes registradas para hoy.</p>';
      return;
    }

    list.innerHTML = orders.map(ord => {
      const hora = new Date(ord.creado_en).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
      const items = Array.isArray(ord.items) ? ord.items : [];
      const itemsList = items.map(i => `${i.cantidad}x ${i.icono || '🥪'} ${i.nombre}`).join(', ');

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

          <div>
            ${ord.estado !== 'entregado' ? `
              <button onclick="updateOrderStatus(${ord.id}, 'entregado')" style="padding: 8px 18px; background: #059669; color: white; border: none; border-radius: 8px; font-weight: 800; font-size: 0.88rem; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: background 0.15s ease;" onmouseover="this.style.background='#047857'" onmouseout="this.style.background='#059669'">
                Entregado
              </button>
            ` : `
              <span style="font-size: 0.82rem; color: #34d399; font-weight: 800; padding: 6px 12px; background: rgba(52, 211, 153, 0.1); border-radius: 6px; border: 1px solid rgba(52, 211, 153, 0.2);">✓ Entregado</span>
            `}
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

    const itemsList = (data.orden && Array.isArray(data.orden.items) ? data.orden.items : []).map(i => `• ${i.cantidad}x ${i.nombre}`).join('\n');
    alert(`¡ENTREGA EXPRESS EXITOSA!\n${data.mensaje}\nAlumno: ${data.estudiante.nombre_completo}\nGrado: ${data.estudiante.grado}\nProductos a entregar:\n${itemsList}`);

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

  sseSource.addEventListener('producto_actualizado', (e) => {
    try {
      const prod = JSON.parse(e.data);
      const idx = posProducts.findIndex(p => p.id === prod.id);
      if (idx !== -1) {
        if (prod.eliminado) {
          posProducts.splice(idx, 1);
        } else {
          posProducts[idx] = { ...posProducts[idx], ...prod };
        }
      } else if (!prod.eliminado) {
        posProducts.push(prod);
      }
      renderPosProducts(currentPosCatId);
    } catch (err) {
      console.error('Error procesando producto_actualizado en POS:', err);
    }
  });

  sseSource.addEventListener('estudiante_actualizado', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = data.id || data.estudiante_id;
      if (scannedStudent && scannedStudent.id === estId) {
        if (typeof data.saldo_colones === 'number') scannedStudent.saldo_colones = data.saldo_colones;
        if (typeof data.disponible_hoy === 'number') scannedStudent.disponible_hoy = data.disponible_hoy;
        renderScannedStudent();
      }
    } catch (err) {}
  });

  sseSource.addEventListener('saldo_actualizado', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = data.id || data.estudiante_id;
      if (scannedStudent && scannedStudent.id === estId) {
        if (typeof data.saldo_colones === 'number') scannedStudent.saldo_colones = data.saldo_colones;
        if (typeof data.disponible_hoy === 'number') scannedStudent.disponible_hoy = data.disponible_hoy;
        renderScannedStudent();
      }
    } catch (err) {}
  });
}
